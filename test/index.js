
'use strict'

const assert = require('assert')
const pg = require('../')

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

    it('query', () => {
      return pg.Pool(config, {debug: false})
        .query('SELECT 1 AS count')
        .subscribe(result => {
          assert.equal(result.rowCount, 1)
          assert.equal(result.rows[0].count, 1)
        })
    })

    it('query transaction', () => {
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
        }, err => assert.fail('there should be no err', err))
    })

     it('query transaction invalid function return', (done) => {
      const pool = pg.Pool(config, {debug: true});
      const transaction = pool.transaction, 
            query = pool.query;

      transaction([
        query('SELECT 2 as count'),
        'SELECT 3 as count',
        x => {
          assert(x.rows[0].count === 3);
          return null; // invalid return step
        }
        ])
        .subscribe(result => {
          assert.fail('there should be no result', result)
        }, err => done())
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
        {}, // invalid value for step
        x => {
          return query('SELECT $1::int as count', [x.rows[0].count+1])
        }
        ])
        .subscribe(result => {
          assert.fail('there should be no result', result)
        }, err => done())
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

    it('end', () => {
      client.end()
    })
  })
})
