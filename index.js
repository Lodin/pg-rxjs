
'use strict'

const Rx = global.Rx || require('rx');
const Rxo = Rx.Observable;
const QueryStream = require('pg-query-stream')
const pg = require('pg')
const slice = [].slice
const deasync = require('deasync')
const _ = require('lodash')
const moment = require('moment')

module.exports = {
  Client,
  Pool,
  pg
}

function _stream(_client, text, value, options) {
  const stream = new Rx.Subject();
  if(text.toString) text = text.toString();
  if(this.opts.debug) console.log('stream:', text, value||'', options||'')

  if(!this.opts.noMoment) { 
    const tmp = parseMoment([text].concat(value));
    text = tmp[0];
    value = tmp[1];
  }

  const query = new QueryStream(text, value, options)
  const source = _client.query(query)
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

function _transaction(queryList) {
  // Same as Client's version
  queryList = ['BEGIN'].concat(queryList);
  queryList.push('COMMIT');

  //if(this.opts.debug) console.log("starting transaction");

  let lastResponse = null;
  return Rxo.fromArray(queryList).reduce((acc, x, i) => {
    /*if(this.opts.debug) 
      console.log('transaction ' + i + ': ', x.toString());*/

    return acc.concatMap( prev => {
      if(i < queryList.length && prev) {
        lastResponse = prev;
      }
      if(!x) return Rxo.just(null);

      if(typeof x === 'string') return this._query(x);
      else if(x.subscribe) return x;
      else if(typeof x === 'function') {
        const r = x(prev);
        if(typeof r === 'string') return this._query(r);
        else if(r && r.subscribe) return r;
        else return this._query(r); // klex
      }
      else return this._query(x); // klex
    })
  }, Rxo.just(null))
  .merge(1)
  .catch( x => {
    lastResponse = null;
    if(this.opts.debug) console.log('Transaction error:', x.message);
    return this._query('ROLLBACK').flatMap(_=>Rxo.throw(x));
  }).first().map(x => lastResponse); // use last response before commit
}

function _query(client, args) {
  if(!client) return Rxo.throw(new Error("Client not reached"));

  let query = args.length > 0 ? args[0] : null;
  if(!query) throw new Error('No query given');

  if(query && typeof query !== 'string') {
    if(query instanceof QueryStream) null; // ignore QS
    else if(typeof query.toString === 'function') {
      query = args[0] = query.toString(); // klex support
    }
    else return Rxo.throw(new Error('Invalid object for query:', typeof query, query));
  }

  if(!this.opts.noMoment) args = parseMoment(args);

  client.rxquery =
   client.rxquery || Rxo.fromNodeCallback(client.query, client);

  const ret = Rxo.defer(x => { 
      if(this.opts.debug) console.log('query:', args);
      return client.rxquery.apply(client, args)
    })
      

  return ret;
}

function replaceNow(m) {
  const unix = m ? m.utc().unix() : moment().utc().unix();
  const x = "to_timestamp(" + unix + ")"
  return x;
}

function parseMoment(x) {
  // query helper
  x[0] = x[0].replace(/\$NOW/g, function() { return replaceNow() });

  if(x.length < 2) return x;

  // Find moment params objects and replace it with timestamp inputs
  let reduceParams = 0;
  x[1] = _.reduce(x[1], (acc, y, i) => {
    const index = i + 1;
    const rindex = index - reduceParams;
    // shift params back
    if(reduceParams>0) x[0] = x[0].replace('$'+(index), '$'+(rindex));
    if(y && y instanceof moment) {
      x[0] = x[0].replace('$'+(rindex), replaceNow(y));
      reduceParams++;
      return acc; // replace param with null
    }
    acc.push(y);
    return acc;
  }, [])

  return x;
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
          transaction: _transaction.bind(this)
          }
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

  let _pool;
  return this._connect().flatMap(pool => {
    _pool = pool;
    return _query.call(this, pool.client, args);
  }).do( 
    () => null, 
    () => _pool.done(), 
    () => _pool.done() )
}

Pool.prototype._stream = function() {
  const args = slice.call(arguments);

  let _pool;
  return this._connect().flatMap(pool => {
    _pool = pool;
    return _stream.call(this, pool.client, args);
  }).do( 
    () => null, 
    () => _pool.done(), 
    () => _pool.done() )
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

  this.opts = opts || {};

  return { query: this._query.bind(this), 
          stream: this._stream.bind(this),
          end: this._end.bind(this),
          transaction: _transaction.bind(this) }
}

Client.prototype._query = function() {
  const args = slice.call(arguments)

  return _query.call(this, this._client, args);
}

Client.prototype._stream = function() {
  const args = slice.call(arguments)

  return _stream.call(this, this._client, args);
}

Client.prototype._end = function() {
  this._client.end()
}
