
'use strict'

const assert = require('assert')
const pg = require('../')

var knex = require('knex')({client: 'pg'}); // for a test-case
var moment = require('moment');

const config = 'postgres://hx:hx@localhost/hx'

describe('## pg-rxjs', () => {
  describe('# Pool', () => {

    it('invalid db uri', done => {
      pg.Pool('postgres://notpassword:hx@localhost:3333/hx')
        .connect()
        .subscribeOnError(err => {
          assert.ok(err.code, 'ECONNREFUSED')
          done()
        })
    })

    it('invalid query', (done) => {
      pg.Pool(config)
        .query('invalid sql')
        .subscribeOnError(err => {
          assert.ok(err.message.startsWith('syntax error'))
          done()
        })
    })

    it('query', (done) => {
      pg.Pool(config, {debug: false})
        .query('SELECT 1 AS count')
        .subscribe(result => {
          assert.equal(result.rowCount, 1)
          assert.equal(result.rows[0].count, 1)
          done()
        }, 
        err => assert.fail('there should be no err', err))
    })

    it('query with knex', (done) => {
      return pg.Pool(config, {debug: false})
        .query(knex.select(1))
        .subscribe(result => {
          assert.equal(result.rowCount, 1)
          assert.equal(result.rows[0]['?column?'], 1)
          done()
        }, 
        err => assert.fail('there should be no err', err))
    })

    it('query transaction', (done) => {
      const pool = pg.Pool(config, {debug: false});
      const transaction = pool.transaction, 
            query = pool.query;
      transaction([
        query('SELECT 2 as count'),
        'SELECT 3 as count',
        x => {
          return query('SELECT $1::int as count', [x.rows[0].count+1])
        }
        ])
        .subscribe(result => {
          assert.equal(result.rowCount, 1)
          assert.equal(result.rows[0].count, 4)
          done()
        }, err => assert.fail('there should be no err', err))
    })

     it('query transaction invalid function query', (done) => {
      const pool = pg.Pool(config, {debug: true});
      const transaction = pool.transaction, 
            query = pool.query;

      transaction([
        query('SELECT 2 as count'),
        'SELECT 3 as count',
        x => {
          assert(x.rows[0].count === 3);
          return '@#'; // invalid return step
        }
        ])
        .subscribe(result => {
          assert.fail('there should be no result', result)
        }, err => {
          assert.ok(err)
          done()
        })
    })

    it('stream', done => {
      let rows = 0;
      pg.Pool(config)
        .stream('SELECT 9 AS count')
        .subscribe(
          data => {
            rows++
            assert(rows === 1)
            assert(data.count === 9)
        }, 
        err => assert.fail('there should be no error', err),
        () => {
          assert(rows === 1);
          done()
        })
    })

    it('stream error on non existent table', done => {
      return pg.Pool(config)
        .stream('SELECT * FROM not_a_table')
        .subscribe(
          () => assert.fail('there should be no data'), 
          err => {
            assert.equal(err.message, 'relation "not_a_table" does not exist')
            done()
          },
          () => {
            assert.fail('there should be no end')
            done()
          })
    })
  })

  describe('# Client', () => {
    let client, query, transaction;

    it('new client', (done) => {
      client = pg.Client(config, {debug: false}); // desync'ed connection
      query = client.query; // query method is bound to client
      transaction = client.transaction;
      done();
    })

    it('invalid query', (done) => {
      query('invalid sql') // calling query without client context
        .subscribeOnError((err) => {
          assert.ok(err.message.startsWith('syntax error'))
          done()
        })
    })

    it('query', (done) => {
      query('SELECT 1 AS count')
        .subscribe((result) => {
          assert.equal(result.rowCount, 1)
          assert.equal(result.rows[0].count, 1)
          done();
        })
    })

    it('query with MOMENT', (done) => {
      const m = moment();
      query('SELECT $NOW AS time_now')
        .subscribe((result) => {
          assert.ok(result.rows[0].time_now, m.toDate().toString())
          assert.equal(result.rowCount, 1)
          done();
        }, err => assert.fail('there should be no error:', err))
    })

    it('query with MOMENT Object', (done) => {
      const m = moment()
      query('SELECT $1 AS time_param, $2::int AS second_param', [m, 42])
        .subscribe((result) => {
          assert.equal(result.rowCount, 1)
          
          assert.equal(result.rows[0].time_param, m.toDate().toString())
          assert.equal(result.rows[0].second_param, 42)
          
          done();
        }, err => assert.fail('there should be no error:', err))
    })

    it('query transaction', (done) => {
      transaction([
        query('SELECT 2 as count'),
        'SELECT 3 as count',
        x => {
          assert(x.rows[0].count === 3);
          return query('SELECT $1::int as count', [x.rows[0].count+1])
        }
        ])
        .subscribe(result => {
          assert.equal(result.rowCount, 1)
          assert.equal(result.rows[0].count, 4)
          done()
        }, err => assert.fail('there should be no err', err))
    })

     it('query transaction invalid query step', (done) => {
      transaction([
        query('SELECT 2 as count'),
        null, // noop step, valid
        { toString: null }, // invalid value for step
        x => {
          return query('SELECT $1::int as count', [x.rows[0].count+1])
        }
        ])
        .subscribe(result => {
          assert.fail('there should be no result', result)
        }, err => {
          assert.ok(err.message.indexOf('Invalid')!==-1)
          done()
        })
    })

    it('stream', done => {
      let rows = 0
      return client.stream('SELECT 10 AS count')
        .subscribe(data => {
          rows++
          assert(rows === 1)
          assert(data.count === 10)
        },
        err => assert.fail('there should be no error', err),
        () => {
          assert(rows === 1);
          done();
        })
    })

    it('stream with Moment', done => {
      let rows = 0
      const m = moment();
      return client.stream('SELECT $NOW AS time_now, $1::int AS other', [1])
        .subscribe(data => {
          rows++
          assert(rows === 1)
          assert.equal(data.time_now, m.toDate().toString())
          assert.equal(data.other, 1);
        },
        err => assert.fail('there should be no error', err),
        () => {
          assert(rows === 1);
          done();
        })
    })

    it('stream with Moment Obj', done => {
      let rows = 0
      const m = moment();
      return client.stream('SELECT $1 AS time_now, $2::int AS other', [m, 1])
        .subscribe(data => {
          rows++
          assert(rows === 1)
          assert.equal(data.time_now, m.toDate().toString())
          assert.equal(data.other, 1);
        },
        err => assert.fail('there should be no error', err),
        () => {
          assert(rows === 1);
          done();
        })
    })

    it('end', () => {
      client.end()
    })
  })
})
