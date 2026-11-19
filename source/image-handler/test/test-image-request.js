// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { GetObjectCommand, S3Client } = require('@aws-sdk/client-s3');
const sinon = require('sinon');
const ImageRequest = require('../image-request');

const bucket = 'allowed-images';
const key = 'artwork/dessin-étoile.png';
const path = `/${bucket}/${key}`;

function request(path, edits) {
    const queryStringParameters = edits === undefined ? null : {
        edits: Buffer.from(JSON.stringify(edits)).toString('base64')
    };
    return { path, headers: { Accept: 'image/webp,*/*' }, queryStringParameters };
}

describe('ImageRequest', function () {
    let getObject;
    let environment;

    beforeEach(function () {
        environment = process.env;
        process.env = { ...environment, PATH_PREFIX: '/', SOURCE_BUCKETS: `${bucket}, other-images`, AUTO_WEBP: 'No' };
        const send = sinon.stub(S3Client.prototype, 'send');
        getObject = send.withArgs(sinon.match.instanceOf(GetObjectCommand)
            .and(sinon.match.has('input', { Bucket: bucket, Key: key })));
    });

    afterEach(function () {
        sinon.restore();
        process.env = environment;
    });

    function respondWithImage(metadata = {}) {
        // SDK v3 returns an S3 body stream that exposes bytes as a Uint8Array.
        const bytes = new Uint8Array([0, 255, 137, 80, 10]);
        getObject.resolves({ Body: { transformToByteArray: async () => bytes }, ...metadata });
        return Buffer.from(bytes);
    }

    it('loads the bucket and UTF-8 key from the path and decodes edits from the query', async function () {
        const image = respondWithImage();
        const edits = { resize: { width: 300, fit: 'inside' } };
        const result = await new ImageRequest().setup(request(path, edits));

        assert.deepEqual(result.originalImage, image);
        assert.deepEqual(result.edits, edits);
        assert.equal(result.ContentType, 'image');
        assert.equal(result.CacheControl, 'max-age=31536000,public');
    });

    it('keeps S3 response metadata when no format or edits are requested', async function () {
        respondWithImage({
            CacheControl: 'max-age=300,public',
            ContentType: 'image/png',
            ExpiresString: '2026-11-21T03:00:00Z',
            LastModified: new Date('2026-11-19T03:00:00Z')
        });
        const result = await new ImageRequest().setup(request(path));

        assert.deepEqual(result.edits, {});
        assert.equal(result.ContentType, 'image/png');
        assert.equal(result.CacheControl, 'max-age=300,public');
        assert.equal(result.Expires, 'Sat, 21 Nov 2026 03:00:00 GMT');
        assert.equal(result.LastModified, 'Thu, 19 Nov 2026 03:00:00 GMT');
    });

    it('uses the first configured bucket for an empty bucket segment', async function () {
        const image = respondWithImage();
        const result = await new ImageRequest().setup(request(`//${key}`));

        assert.deepEqual(result.originalImage, image);
    });

    it('reads the key after a configured path prefix', async function () {
        const image = respondWithImage();
        process.env.PATH_PREFIX = '/image/';
        const result = await new ImageRequest().setup(request(`/image${path}`));

        assert.deepEqual(result.originalImage, image);
    });

    for (const formatEdit of [{ toFormat: 'jpeg' }, { outputFormat: 'jpeg' }]) {
        it(`uses ${Object.keys(formatEdit)[0]} to choose a response format`, async function () {
            respondWithImage({ ContentType: 'image/png' });
            const result = await new ImageRequest().setup(request(path, formatEdit));

            assert.equal(result.ContentType, 'image/jpeg');
        });
    }

    it('only negotiates WebP when enabled and accepted', async function () {
        respondWithImage({ ContentType: 'image/png' });
        const event = request(path);
        assert.equal((await new ImageRequest().setup(event)).ContentType, 'image/png');
        process.env.AUTO_WEBP = 'Yes';
        assert.equal((await new ImageRequest().setup(event)).ContentType, 'image/webp');
        event.headers.Accept = 'image/png';
        assert.equal((await new ImageRequest().setup(event)).ContentType, 'image/png');
    });

    it('prefers an explicit toFormat over automatic WebP', async function () {
        respondWithImage({ ContentType: 'image/png' });
        process.env.AUTO_WEBP = 'Yes';
        const result = await new ImageRequest().setup(request(path, { toFormat: 'jpeg' }));

        assert.equal(result.ContentType, 'image/jpeg');
    });

    it('rejects paths outside configured buckets, including legacy Thumbor paths', async function () {
        await assert.rejects(new ImageRequest().setup(request('/unlisted/art.png')),
            { status: 403, code: 'ImageBucket::CannotAccessBucket' });
        await assert.rejects(new ImageRequest().setup(request('/filters:grayscale()/art.png')),
            { status: 403, code: 'ImageBucket::CannotAccessBucket' });
    });

    it('rejects requests without a key', async function () {
        await assert.rejects(new ImageRequest().setup(request(`/${bucket}`)),
            { status: 404, code: 'ImageEdits::CannotFindImage' });
    });

    it('rejects an invalid base64 edits payload', async function () {
        const event = { ...request(path), queryStringParameters: { edits: 'not-a-json-payload' } };
        await assert.rejects(new ImageRequest().setup(event),
            { status: 400, code: 'DecodeRequest::CannotDecodeRequest' });
    });

    it('reports when the source bucket setting is missing', async function () {
        delete process.env.SOURCE_BUCKETS;
        await assert.rejects(new ImageRequest().setup(request(path)),
            { status: 400, code: 'GetAllowedSourceBuckets::NoSourceBuckets' });
    });

    it('maps S3 NoSuchKey to a 404 with its service code and message', async function () {
        getObject.rejects({ name: 'NoSuchKey', $metadata: { httpStatusCode: 404 }, message: 'Missing object' });

        await assert.rejects(new ImageRequest().setup(request(path)),
            { status: 404, code: 'NoSuchKey', message: 'Missing object' });
    });

    it('keeps the existing 500 mapping for other S3 errors', async function () {
        getObject.rejects({ name: 'AccessDenied', $metadata: { httpStatusCode: 403 }, message: 'Access denied' });

        await assert.rejects(new ImageRequest().setup(request(path)),
            { status: 500, code: 'AccessDenied', message: 'Access denied' });
    });
});
