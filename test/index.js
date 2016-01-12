
'use strict'

const assert = require('assert')
const pg = require('../')

const config = 'postgres://hx:hx@localhost/hx'

describe('## pg-then', () => {
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
      return pg.Pool(config)
        .query('SELECT 1 AS count')
        .subscribe((result) => {
          assert.equal(result.rowCount, 1)
          assert.equal(result.rows[0].count, 1)
        })
    })

    it('stream', done => {
      let rows = 0
      return pg.Pool(config)
        .stream('SELECT 1 AS count')
        .subscribe(
          data => {
          rows++
          assert(rows === 1)
        }, 
        err => done(err), 
        () => done())
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
    let client, query;

    it('new client', (done) => {
      client = pg.Client(config); // desync'ed connection
      query = client.query; // query method is bound to client
      done();
    })

    it('invalid query', (done) => {
      query('invalid sql') // calling query without client context
        .subscribeOnError((err) => {
          assert.ok(err.message.startsWith('syntax error'))
          done()
        })
    })

    it('query', () => {
      return client.query('SELECT 1 AS count')
        .subscribe((result) => {
          assert.equal(result.rowCount, 1)
          assert.equal(result.rows[0].count, 1)
        })
    })

    it('stream', done => {
      let rows = 0
      return client
        .stream('SELECT 1 AS count')
        .subscribe(data => {
          rows++
          assert(rows === 1)
        },
        err => done(err),
        () => done() )
    })

    it('end', () => {
      client.end()
    })
  })
})
