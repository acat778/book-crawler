import assert from 'node:assert/strict'
import fs from 'node:fs'

const schema = fs.readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8')
const repository = fs.readFileSync(new URL('../src/persistence/book-repository.js', import.meta.url), 'utf8')

assert.match(schema, /model ReadBookAuthor/)
assert.match(schema, /@@map\("t_read_book_author"\)/)
assert.doesNotMatch(schema, /t_acat_user_author|model AcatUserAuthor/)
assert.match(schema, /fileType\s+String\s+@default\("other"\)\s+@map\("file_type"\)/)
assert.match(repository, /prisma\.readBookAuthor/)
assert.match(repository, /fileType: 'book_cover'/)

console.log('schema-sync tests passed')
