import { MongoClient } from 'mongodb'
import config from '../config.js'

let client

export async function getMongoDb() {
  if (!client) {
    client = new MongoClient(config.mongo.uri)
    await client.connect()
  }
  return client.db(config.mongo.dbName)
}
