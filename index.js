
'use strict'

const Rx = global.Rx || require('rx');
const Rxo = Rx.Observable;
const QueryStream = require('pg-query-stream')
const pg = require('pg')
const slice = [].slice
const deasync = require('deasync')

module.exports = {
  Client,
  Pool,
  pg
}

function _transaction(_this, queryList) {
  // Same as Client's version
  queryList = ['BEGIN'].concat(queryList);
  queryList.push('COMMIT');

  //if(_this.opts.debug) console.log("starting transaction");

  let lastResponse = null;
  return Rxo.fromArray(queryList).reduce((acc, x, i) => {
    /*if(_this.opts.debug) 
      console.log('transaction ' + i + ': ', x.toString());*/

    return acc.concatMap( prev => {
      if(i < queryList.length && prev) {
        lastResponse = prev;
      }
      if(!x) return Rxo.just(null);

      if(typeof x === 'string') return _this._query(x);
      else if(x.subscribe) return x;
      else if(typeof x === 'function') {
        const r = x(prev);
        if(typeof r === 'string') return _this._query(r);
        else if(r && r.subscribe) return r;
        else throw new Error('Invalid transaction step fn return', typeof r, r)
      }
      else throw new Error('Invalid transaction step type', typeof x, x)
    })
  }, Rxo.just(null))
  .merge(1)
  .catch( x => {
    lastResponse = null;
    if(_this.opts.debug) console.log('Transaction error:', x);
    return _this._query('ROLLBACK').flatMap(_=>Rxo.throw(x));
  }).first().map(x => lastResponse); // use last response before commit
}

/**
 * Pool
 */

function Pool(config, opts) {
  if (!(this instanceof Pool)) {
    return new Pool(config, opts)
  }

  this.config = config;
  this.opts = opts || {};

  return { 
          connect: this._connect.bind(this),
          query: this._query.bind(this), 
          stream: this._stream.bind(this),
          transaction: this._transaction.bind(this)
          }
}

Pool.prototype._transaction = function(x) {
 return _transaction(this, x)
}

Pool.prototype._connect = function() {
  return Rxo.create((obs) => {
    let _done = x=>x;
    pg.connect(this.config, (error, client, done) => {
      _done = done;
      //console.log(error, client, done)
      if (error) {
        done(error)
        obs.onError(error) // Todo: Error obj needed?
        obs.onCompleted();
        return
      }

      obs.onNext({ client, done })
      obs.onCompleted();
    })

    return dispose=>_done();
  });
}

Pool.prototype._query = function() {
  const args = slice.call(arguments);

  return this._connect().flatMap((pool) => {
    if(!pool || !pool.client) return Rxo.throw(new Error("Pool not reached"));

    pool.client.rxquery = pool.client.rxquery 
        || Rxo.fromNodeCallback(pool.client.query, pool.client);

    const ret = Rxo.defer(x => { 
        if(this.opts.debug) console.log('query:', args);
        return pool.client.rxquery.apply(pool.client, args)
      })
      .do( () => null, () => pool.done(), () => pool.done() )

    return ret;
  })
}

Pool.prototype._stream = function(text, value, options) {
  //const stream = new Rx.Subject();

  return this._connect().flatMap(pool => Rxo.create(stream => {
    if(this.opts.debug) console.log('stream:', text, value || '', options || '')
    const query = new QueryStream(text, value, options)
    const source = pool.client.query(query)
    source.on('end', cleanup)
    source.on('error', onError)
    source.on('close', cleanup)
    source.on('data', onData)

    function onError(err) {
      stream.onError(err)
      cleanup()
    }

    function onData(x) {
      stream.onNext(x)
    }

    function cleanup() {
      pool.done()

      source.removeListener('data', onData)
      source.removeListener('end', cleanup)
      source.removeListener('error', onError)
      source.removeListener('close', cleanup)
      stream.onCompleted()
    }

    return cleanup;
  })).catch(err => Rxo.throw(err) )
}

/**
 * Client
 */
function Client(config, opts) {
  if (!(this instanceof Client)) {
    return new Client(config, opts)
  }

  const _client = this._client = new pg.Client(config)
  let connected = false

  this._client.connect((error) => {
    if (error) {
      throw error
    }
    connected = true
  })
  deasync.loopWhile(function(){ return !connected });

  this._rxquery = Rxo.fromNodeCallback(_client.query, _client);

  this.opts = opts || {};

  return { query: this._query.bind(this), 
          stream: this._stream.bind(this),
          end: this._end.bind(this),
          transaction: this._transaction.bind(this) }
}

Client.prototype._transaction = function(x) {
 return _transaction(this, x)
}

Client.prototype._query = function() {
  const args = slice.call(arguments)

  const _rxquery = this._rxquery;
  return Rxo.defer(x => {
     if(this.opts.debug) console.log('query:', args);
    return _rxquery.apply(null, args)
  });
}

Client.prototype._stream = function(text, value, options) {
  const stream = new Rx.Subject();
  if(this.opts.debug) console.log('stream:', text, value||'', options||'')

  const query = new QueryStream(text, value, options)
  const source = this._client.query(query)
  source.on('end', cleanup)
  source.on('error', onError)
  source.on('close', cleanup)
  source.on('data', onData)

  function onData(x) {
    stream.onNext(x)
  }

  function onError(err) {
    stream.onError(err)
    cleanup()
  }

  function cleanup() {
    source.removeListener('data', onData)
    source.removeListener('end', cleanup)
    source.removeListener('error', onError)
    source.removeListener('close', cleanup)
    stream.onCompleted()
  }

  return stream.asObservable();
}

Client.prototype._end = function() {
  this._client.end()
}
