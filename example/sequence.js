
'use strict'

const pg = require('../')

const dbUri = 'postgres://hx:hx@localhost/hx'
const pool = pg.Pool(dbUri)

let count = 0

function runSequence(result) {
  console.log('try:', count += 1)

  if (result) {
    console.log(result.rows[0])
  }

  if (count > 100000) {
    return console.log('success')
  }

  pool.query('SELECT COUNT(*) from pg_stat_activity')
    .do(runSequence)
    .subscribeOnError((err) => {
      console.error(err)
    })
}

runSequence()
