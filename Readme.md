
[![NPM version][npm-img]][npm-url]
[![Build status][travis-img]][travis-url]
[![Test coverage][coveralls-img]][coveralls-url]
[![License][license-img]][license-url]
[![Dependency status][david-img]][david-url]

### pg-rxjs

* Use `postgresql` with [`Rx`](https://github.com/Reactive-Extensions/RxJS) api, based on [pg](https://github.com/brianc/node-postgres).

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
  .subscribe(data => ..., end => ..., err => ...)
```

* [Use QueryStream](https://github.com/brianc/node-pg-query-stream)

```js
pg.Pool(config)
  .stream('SELECT ...')
  .map(data => ...)
  .subscribe(data => ..., end => ..., err => ...)
```

* [Client instance](https://github.com/brianc/node-postgres#client-instance)

```js
const pg = require('pg-rxjs')

const client = pg.Client('postgres://username:password@localhost/database')

client
  .query('SELECT ...')
  .map(...)
  .subscribe(data => ..., end => ..., err => ...)

// ...

client.end()
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
