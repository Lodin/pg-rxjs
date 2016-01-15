
[![NPM version][npm-img]][npm-url]
[![Build status][travis-img]][travis-url]
[![Test coverage][coveralls-img]][coveralls-url]
[![License][license-img]][license-url]
[![Dependency status][david-img]][david-url]

### pg-rxjs

* Use `postgresql` with [`Rx`](https://github.com/Reactive-Extensions/RxJS) api, based on [pg](https://github.com/brianc/node-postgres).
* Based on [`pg-then`](https://github.com/coderhaoxin/pg-then) using Rx and adding transaction support

### Install

```bash
$ npm install pg
$ npm install pg-rxjs
```

### Usage

* [Client pooling](https://github.com/brianc/node-postgres#client-pooling)

```js
const pg = require('pg-rxjs')

const pool = pg.Pool('postgres://username:password@localhost/database')

pool
  .query('SELECT ...')
  .map(...)
  .subscribe(data => ..., err => ..., end => ...)
```

* [Use QueryStream](https://github.com/brianc/node-pg-query-stream)

```js
pg.Pool(config)
  .stream('SELECT ...')
  .map(data => ...) // runs for each row streamed from the query
  .subscribe(data => ..., err => ..., end => ...)
```

* [Client instance](https://github.com/brianc/node-postgres#client-instance)

```js
const pg = require('pg-rxjs')

const client = pg.Client('postgres://username:password@localhost/database')
const query = client.query; // methods are already bound to the client

query('SELECT ...')
  .map(data => ...)
  .subscribe(data => ..., err => ..., end => ...)

// ...

client.end()
```

* [Transactions](https://github.com/brianc/node-postgres/wiki/Transactions) (\w auto-rollback)
_supports only waterfall queuing_

```js
var transaction = client.transaction; // btw, methods do not rely on 'this'
var query = client.query;

transaction([
  // use the query method
  query('SELECT 2 as count'), 

  // or use a raw string to query
  'SELECT 3 as count', 
  
  // or use a fn: x is the response of the previous query
   x => { 
    assert(x.rows[0].count === 3);
    return query('SELECT $1::int as count', [x.rows[0].count+1])
   }
  ])
  .subscribe(
    result => {
      assert.equal(result.rowCount, 1)
      assert.equal(result.rows[0].count, 4)
    }, 
    err => assert.fail('code will auto rollback'),
    () => console.log('completed') 
  )

```

* Input time using [Moment.js](http://momentjs.com/)
Disable by setting opts: pg.Client(url, {noMoment: true})

```
// Use $NOW to insert a timestamp value of the current UTC time
query('SELECT $NOW AS time_now')
// .. the same as query('SELECT to_timestamp(1452819700) as time_now')


// Use a moment object to insert a placeholder as a timestamp
// Note: no need to specify the paremeter as a timestamp
const m = moment();
query('SELECT $1 AS time_param, $2::int AS second_param', [m, 42])
  .subscribe((result) => {
    console.log('result', result, typeof result.rows[0].time_param);
    assert.equal(result.rowCount, 1)
    
    assert.equal(result.rows[0].time_param, m.toDate().toString())
    assert.equal(result.rows[0].second_param, 42)
    
    done();
  }, err => assert.fail('there should be no error:', err))
```

### License
MIT

[npm-img]: https://img.shields.io/npm/v/pg-rxjs.svg?style=flat-square
[npm-url]: https://npmjs.org/package/pg-rxjs
[travis-img]: https://img.shields.io/travis/jadbox/pg-rxjs.svg?style=flat-square
[travis-url]: https://travis-ci.org/jadbox/pg-rxjs
[coveralls-img]: https://img.shields.io/coveralls/jadbox/pg-rxjs.svg?style=flat-square
[coveralls-url]: https://coveralls.io/r/jadbox/pg-rxjs?branch=master
[license-img]: https://img.shields.io/badge/license-MIT-green.svg?style=flat-square
[license-url]: http://opensource.org/licenses/MIT
[david-img]: https://img.shields.io/david/jadbox/pg-rxjs.svg?style=flat-square
[david-url]: https://david-dm.org/jadbox/pg-rxjs
