import assert from 'node:assert/strict'
import { after, beforeEach, describe, it } from 'node:test'

import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'

import { AttachmentRejected, MAX_ATTACHMENT_BYTES } from './attachmentRules.js'

/**
 * The storage module with the S3 client's `send` stood in for: what is sent to
 * R2, under which key, and how a campaign's files are deleted page by page.
 * Nothing reaches the bucket.
 *
 * The module reads its configuration at import, so the tests are skipped on a
 * machine without backend/.env.
 */
const storage = await import('./storage.js').catch(() => null)

const sent: unknown[] = []
let answers: unknown[] = []

const hadOwnSend = Object.hasOwn(S3Client.prototype, 'send')
const realSend: unknown = Reflect.get(S3Client.prototype, 'send')

Reflect.set(S3Client.prototype, 'send', (command: unknown) => {
  sent.push(command)
  return Promise.resolve(answers.shift() ?? {})
})

after(() => {
  if (hadOwnSend) {
    Reflect.set(S3Client.prototype, 'send', realSend)
  } else {
    Reflect.deleteProperty(S3Client.prototype, 'send')
  }
})

beforeEach(() => {
  sent.length = 0
  answers = []
})

function inputOf<T extends { input: object }>(
  command: unknown,
  type: new (...args: never[]) => T,
): T['input'] {
  assert.ok(command instanceof type, `expected a ${type.name}`)
  return command.input
}

describe(
  'attachment storage',
  { skip: storage ? false : 'the backend configuration is not set' },
  () => {
    const { deleteAttachment, deleteCampaignFiles, getAttachment, putAttachment } =
      storage ?? ({} as NonNullable<typeof storage>)

    it('refuses an empty file, one over 10 MB and a type other than PDF or Word, before uploading', async () => {
      const pdf = 'application/pdf'

      await assert.rejects(
        putAttachment('c1', Buffer.alloc(0), 'cv.pdf', pdf),
        AttachmentRejected,
      )
      await assert.rejects(
        putAttachment('c1', Buffer.alloc(MAX_ATTACHMENT_BYTES + 1), 'cv.pdf', pdf),
        AttachmentRejected,
      )
      await assert.rejects(
        putAttachment('c1', Buffer.from('MZ'), 'cv.exe', 'application/x-msdownload'),
        AttachmentRejected,
      )
      assert.equal(sent.length, 0)
    })

    it('stores under a key generated per campaign, never under the file name', async () => {
      const stored = await putAttachment(
        'c1',
        Buffer.from('%PDF-1.7'),
        '../../etc/passwd CV.pdf',
        'application/pdf',
      )

      assert.match(stored.key, /^campaigns\/c1\/[0-9a-f-]{36}\.pdf$/)
      assert.ok(!stored.name.includes('/'), 'a path separator survived in the name')
      assert.equal(stored.size, 8)

      const input = inputOf(sent[0], PutObjectCommand)
      assert.equal(input.Key, stored.key)
      assert.equal(input.Bucket, process.env.S3_BUCKET)
      assert.equal(input.ContentType, 'application/pdf')
    })

    it('reads an attachment back as a buffer', async () => {
      answers = [
        {
          Body: {
            transformToByteArray: () => Promise.resolve(new Uint8Array([1, 2, 3])),
          },
        },
      ]

      const body = await getAttachment('campaigns/c1/cv.pdf')

      assert.deepEqual([...body], [1, 2, 3])
      assert.equal(inputOf(sent[0], GetObjectCommand).Key, 'campaigns/c1/cv.pdf')
    })

    it('fails on a stored object that has no content', async () => {
      answers = [{}]
      await assert.rejects(getAttachment('campaigns/c1/cv.pdf'), /no content/)
    })

    it('deletes one attachment by its key', async () => {
      await deleteAttachment('campaigns/c1/old.pdf')
      assert.equal(inputOf(sent[0], DeleteObjectCommand).Key, 'campaigns/c1/old.pdf')
    })

    it('deletes every object under a campaign, page after page', async () => {
      answers = [
        {
          Contents: [{ Key: 'campaigns/c1/a.pdf' }, { Key: 'campaigns/c1/b.pdf' }],
          IsTruncated: true,
          NextContinuationToken: 'page-2',
        },
        {},
        { Contents: [{ Key: 'campaigns/c1/c.pdf' }, {}], IsTruncated: false },
        {},
      ]

      await deleteCampaignFiles('c1')

      const firstList = inputOf(sent[0], ListObjectsV2Command)
      assert.equal(firstList.Prefix, 'campaigns/c1/')
      assert.equal(firstList.ContinuationToken, undefined)
      assert.deepEqual(inputOf(sent[1], DeleteObjectsCommand).Delete?.Objects, [
        { Key: 'campaigns/c1/a.pdf' },
        { Key: 'campaigns/c1/b.pdf' },
      ])
      assert.equal(inputOf(sent[2], ListObjectsV2Command).ContinuationToken, 'page-2')
      assert.deepEqual(inputOf(sent[3], DeleteObjectsCommand).Delete?.Objects, [
        { Key: 'campaigns/c1/c.pdf' },
      ])
      assert.equal(sent.length, 4)
    })

    it('sends no delete for a campaign without files', async () => {
      answers = [{ IsTruncated: false }]

      await deleteCampaignFiles('c1')

      assert.equal(sent.length, 1)
    })
  },
)
