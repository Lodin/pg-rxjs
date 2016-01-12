
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

/**
 * Pool
 */

function Pool(config) {
  if (!(this instanceof Pool)) {
    return new Pool(config)
  }

  this.config = config

  return { 
          connect: this._connect.bind(this),
          query: this._query.bind(this), 
          stream: this._stream.bind(this),
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
  const args = slice.call(arguments)

  return this._connect().flatMap((pool) => {
    if(!pool || !pool.client) return Rxo.throw(new Error("Pool not reached"));

    pool.client.rxquery = pool.client.rxquery 
        || Rxo.fromNodeCallback(pool.client.query, pool.client);

    return Rxo.defer(x => pool.client.rxquery.apply(pool.client, args))
            .do( () => null, () => pool.done(), () => pool.done() )
  })
}

Pool.prototype._stream = function(text, value, options) {
  //const stream = new Rx.Subject();

  return this._connect().flatMap(pool => Rxo.create(stream => {
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
function Client(config) {
  if (!(this instanceof Client)) {
    return new Client(config)
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

  return { query: this._query.bind(this), 
          stream: this._stream.bind(this),
          end: this._end.bind(this) }
}

Client.prototype._query = function() {
  const args = slice.call(arguments)
  const _rxquery = this._rxquery;
  
  return Rxo.defer(x => _rxquery.apply(null, args));
}

Client.prototype._stream = function(text, value, options) {
  const stream = new Rx.Subject();

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
