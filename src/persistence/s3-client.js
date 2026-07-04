import { CreateBucketCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import config from '../config.js'

const client = new S3Client({
  endpoint: config.storage.endpoint,
  region: config.storage.region,
  forcePathStyle: true,
  credentials: {
    accessKeyId: config.storage.accessKey,
    secretAccessKey: config.storage.secretKey,
  },
})

let bucketReady = false

async function ensureBucket() {
  if (bucketReady) return
  try {
    await client.send(new HeadBucketCommand({ Bucket: config.storage.bucket }))
  } catch (err) {
    if (err?.name !== 'NotFound' && err?.name !== 'NoSuchBucket' && err?.$metadata?.httpStatusCode !== 404) {
      throw err
    }
    await client.send(new CreateBucketCommand({ Bucket: config.storage.bucket }))
  }
  bucketReady = true
}

export async function uploadObject({ key, body, contentType }) {
  await ensureBucket()
  await client.send(new PutObjectCommand({
    Bucket: config.storage.bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
    ContentLength: body.length,
  }))
}
