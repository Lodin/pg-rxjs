
'use strict'

const Rx = global.Rx || require('rx');
const Rxo = Rx.Observable;
const QueryStream = require('pg-query-stream')
const pg = require('pg')
const slice = [].slice

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
}

Pool.prototype.connect = function() {
  return Rxo.create((obs) => {
    pg.connect(this.config, (error, client, done) => {
      if (error) {
        done(error)
        obs.onNext(Rxo.throw(new Error(error))) // Todo: Error obj needed?
        return
      }

      obs.onNext({ client, done })
      obs.onCompleted();
    })
  }).asObservable();
}

Pool.prototype.query = function() {
  const args = slice.call(arguments)

  return this.connect().map((pool) => {
    if(!pool) throw new Error("Pool not reached");
    const rxquery = Rxo.fromNodeCallback(pool.client.query, pool.client);
    return Rxo.defer(x => rxquery.apply(null, args))
            .do( _ => _, _ => pool.done(), _ => pool.done() );
  })
}

Pool.prototype.stream = function(text, value, options) {
  const stream = new Rx.Subject();

  this.connect().map(pool => {
    const query = new QueryStream(text, value, options)
    const source = pool.client.query(query)
    source.on('end', cleanup)
    source.on('error', onError)
    source.on('close', cleanup)
    source.on('data', onData)

    function onError(err) {
      stream.onNext(Rx.throw(err))
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
  }).catch(err => stream.onNext(Rxo.throw(err)))

  return stream.asObservable();
}

/**
 * Client
 */
function Client(config) {
  if (!(this instanceof Client)) {
    return new Client(config)
  }

  this._client = new pg.Client(config)
  this._client.connect((error) => {
    if (error) {
      throw error
    }
  })

  this._rxquery = Rxo.fromNodeCallback(this._client, this);

}

Client.prototype.query = function() {
  const args = slice.call(arguments)
  const _rxquery = this._rxquery;
  
  console.log('ssssss', _rxquery);
  return Rxo.defer(x => _rxquery.apply(null, args));
}

Client.prototype.stream = function(text, value, options) {
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
    stream.onNext(Rxo.throw(err))
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

Client.prototype.end = function() {
  this._client.end()
}
