import crypto from 'node:crypto'

import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'

import { env } from '../config/env.js'

import {
  AttachmentRejected,
  MAX_ATTACHMENT_BYTES,
  assertAllowedType,
  safeFileName,
} from './attachmentRules.js'

/**
 * Attachment storage, on Cloudflare R2 through its S3 API.
 *
 * The bucket is private. The backend reads an object when it builds a message
 * and when the user downloads it back; no URL ever points at it, so nothing
 * leaks by being guessed.
 */

export interface StoredAttachment {
  key: string
  name: string
  size: number
  contentType: string
}

const client = new S3Client({
  region: env.storage.region,
  endpoint: env.storage.endpoint,
  credentials: {
    accessKeyId: env.storage.accessKeyId,
    secretAccessKey: env.storage.secretAccessKey,
  },
  // R2 does not serve the virtual-hosted style these clients default to.
  forcePathStyle: true,
})

export async function putAttachment(
  campaignId: string,
  body: Buffer,
  rawName: string,
  contentType: string,
): Promise<StoredAttachment> {
  if (body.byteLength === 0) {
    throw new AttachmentRejected('The file is empty')
  }

  if (body.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new AttachmentRejected('The file is larger than 10 MB')
  }

  const extension = assertAllowedType(contentType)
  const name = safeFileName(rawName, extension)

  // The key is generated and scoped by campaign. Nothing from the filename
  // reaches it, and replacing an attachment writes a new key rather than
  // overwriting one a send in flight may be reading.
  const key = `campaigns/${campaignId}/${crypto.randomUUID()}.${extension}`

  await client.send(
    new PutObjectCommand({
      Bucket: env.storage.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  )

  return { key, name, size: body.byteLength, contentType }
}

export async function getAttachment(key: string): Promise<Buffer> {
  const result = await client.send(
    new GetObjectCommand({ Bucket: env.storage.bucket, Key: key }),
  )

  if (!result.Body) {
    throw new Error('The stored attachment has no content')
  }

  return Buffer.from(await result.Body.transformToByteArray())
}

export async function deleteAttachment(key: string): Promise<void> {
  await client.send(new DeleteObjectCommand({ Bucket: env.storage.bucket, Key: key }))
}

/**
 * Deletes every object stored under a campaign.
 *
 * By prefix rather than by the one key the campaign row points at: a replaced
 * attachment whose deletion failed at the time is still under the same prefix,
 * and an account deletion is the moment it must go too.
 */
export async function deleteCampaignFiles(campaignId: string): Promise<void> {
  const prefix = `campaigns/${campaignId}/`
  let continuationToken: string | undefined

  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: env.storage.bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    )

    const objects = (page.Contents ?? []).flatMap((object) =>
      object.Key ? [{ Key: object.Key }] : [],
    )

    if (objects.length > 0) {
      await client.send(
        new DeleteObjectsCommand({
          Bucket: env.storage.bucket,
          Delete: { Objects: objects, Quiet: true },
        }),
      )
    }

    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (continuationToken)
}
