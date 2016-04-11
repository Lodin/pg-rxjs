'use strict'

const Rx = global.Rx || require('rx');
const Rxo = Rx.Observable;
const QueryStream = require('pg-query-stream')
//const pg = require('pg');
const slice = [].slice
const deasync = require('deasync')
const _ = require('lodash')
const moment = require('moment')
let QI = 0; // debug query index

module.exports = {
  Client,
  Pool
}

function _stream(_client, text, value, options) {
  const stream = new Rx.Subject();
  if(text.toString) text = text.toString();
  if(this.opts.debug) console.log('stream:', text, value||'', options||'')

  if(!this.opts.noMoment) { 
    const tmp = parseMoment(text, value);
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
    stream.onNext(x);
  }

  function onError(err) {
    stream.onError(err);
    cleanup();
  }

  function cleanup(x) {
    source.removeListener('data', onData)
    source.removeListener('end', cleanup)
    source.removeListener('error', onError)
    source.removeListener('close', cleanup)
    stream.onCompleted()
  }

  return stream.asObservable();
}

function _transaction(queryList, client) {
  // Same as Client's version
  queryList = ['BEGIN'].concat(queryList);
  queryList.push('COMMIT');
  //console.log('queryList', queryList)

  //if(this.opts.debug) console.log("starting transaction");

  let lastResponse = null;
  return Rxo.fromArray(queryList).reduce((acc, x, i) => {
    if(this.opts.debug) {
      if(typeof x === 'function')
        console.log('transaction ' + i + ': function');
      else if(!!x.subscribe) console.log('transaction ' + i + ': Rx');
      else console.log('transaction ' + i + ':', JSON.stringify(x));
    }

    return acc.first().concatMap( prev => {
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
    var err = JSON.stringify(x);
    if(this.opts.debug) 
      console.log('Transaction error:', x.message, err);
    return this._query('ROLLBACK').flatMap(_=> Rxo.throw( {message:x.message, detail:err} ));
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

  if(!this.opts.noMoment) {
    const tmp = parseMoment(args[0], args[1]);
    args[0] = query = tmp[0];
    args[1] = tmp[1];
  }

  QI++;

  client.rxquery =
   client.rxquery || Rxo.fromNodeCallback(client.query, client);

  const ret = Rxo.defer(x => { 
      if(this.opts.debug) console.log(QI + ' query:', args);
      var invokedrx = client.rxquery.apply(client, args);
      if(this.opts.debug) invokedrx = invokedrx.do(
        x => console.log(QI + ' done:', x.rows),
        x => console.log(QI + ' error:', x)
      )
      return invokedrx;
    })
      

  return ret;
}

function replaceNow(m) {
  const unix = m ? m.utc().unix() : moment().utc().unix();
  const x = "to_timestamp(" + unix + ")"
  return x;
}

function parseMoment(q, p) {
  // query helper
  q = q.replace(/\$NOW/g, function() { return replaceNow() });

  if(!p || !Array.isArray(p)) return [q, p];

  // Find moment params objects and replace it with timestamp inputs
  let reduceParams = 0;
  p = _.reduce(p, (acc, y, i) => {
    const index = i + 1;
    const rindex = index - reduceParams;
    // shift params back
    if(reduceParams>0) q = q.replace('$'+(index), '$'+(rindex));
    if(y && y instanceof moment) {
      q = q.replace('$'+(rindex), replaceNow(y));
      reduceParams++;
      return acc; // replace param with null
    }
    acc.push(y);
    return acc;
  }, [])

  return [q, p];
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
          transaction: this.__transaction.bind(this), 
          }
}

Pool.prototype.__transaction = function(queryList) {
  const args = slice.call(arguments);

  if(this._pool) return _transaction.call(this, queryList, this._pool.client);
  return this._connect().flatMap(pool => {
    this._pool = pool;
    return _transaction.call(this, pool.client, args);
  }).do( 
    () => null, 
    () => { 
      this._pool.done(); 
      this._pool = null },
    () => { 
      this._pool.done(); 
      this._pool = null })
}

Pool.prototype._connect = function() {
  if(!this.pg) {
    this.pg = require('pg');
    if(!!this.opts.native) this.pg = this.pg.native;
  }

  return Rxo.create((obs) => {
    let _done = x=>x;
    this.pg.connect(this.config, (error, client, done) => {
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

  if(this._pool) {
    return _query.call(this, this._pool.client, args);
  }

  let _pool;
  return this._connect().flatMap(pool => {
    _pool = pool;
    return _query.call(this, pool.client, args);
  }).do( 
    () => null, 
    () => _pool.done(), 
    () => _pool.done() )
}

Pool.prototype._stream = function(text, value, options) {
  let _pool;
  return this._connect().flatMap(pool => {
    _pool = pool;
    return _stream.call(this, pool.client, text, value, options);
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

  let pg = require('pg');
  if(!!opts.native) pg = pg.native;

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

Client.prototype._stream = function(text, value, options) {
  return _stream.call(this, this._client, text, value, options);
}

Client.prototype._end = function() {
  this._client.end()
}
