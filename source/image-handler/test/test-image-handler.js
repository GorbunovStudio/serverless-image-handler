// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { GetObjectCommand, S3Client } = require('@aws-sdk/client-s3');
const { DetectFacesCommand, RekognitionClient } = require('@aws-sdk/client-rekognition');
const sharp = require('sharp');
const sinon = require('sinon');
const ImageHandler = require('../image-handler');

function solidImage(width, height, background) {
    return sharp({ create: { width, height, channels: 4, background } }).png().toBuffer();
}

function stubImageDownload() {
    const send = sinon.stub(S3Client.prototype, 'send');
    return send.withArgs(sinon.match.instanceOf(GetObjectCommand)
        .and(sinon.match.has('input', { Bucket: 'overlays', Key: 'watermark.png' })));
}

function stubFaceDetection(command = sinon.match.instanceOf(DetectFacesCommand)) {
    const send = sinon.stub(RekognitionClient.prototype, 'send');
    return send.withArgs(command);
}

function detectFace(originalImage) {
    return stubFaceDetection(sinon.match.instanceOf(DetectFacesCommand)
        .and(sinon.match.has('input', { Image: { Bytes: originalImage } })))
        .resolves({ FaceDetails: [{ BoundingBox: { Left: 0.25, Top: 0.25, Width: 0.5, Height: 0.25 } }] });
}

function pixel(data, info, x, y) {
    const start = (y * info.width + x) * info.channels;
    return Array.from(data.subarray(start, start + info.channels));
}

describe('ImageHandler', function () {
    afterEach(function () {
        sinon.restore();
    });

    it('applies grayscale and flip to the output pixels', async function () {
        const originalPixels = Buffer.from([255, 100, 50, 0, 0, 0]);
        const originalImage = await sharp(originalPixels, { raw: { width: 1, height: 2, channels: 3 } })
            .png().toBuffer();
        const result = await new ImageHandler().process({ originalImage, edits: { grayscale: true, flip: true } });
        const { data, info } = await sharp(Buffer.from(result, 'base64')).raw().toBuffer({ resolveWithObject: true });

        const first = pixel(data, info, 0, 0);
        const second = pixel(data, info, 0, 1);
        assert.deepEqual(first, [0, 0, 0]);
        assert.ok(second[0] > 0);
        assert.equal(second[0], second[1]);
        assert.equal(second[1], second[2]);
    });

    it('returns image data in the requested format', async function () {
        const originalImage = await solidImage(4, 4, 'red');
        const result = await new ImageHandler().process({ originalImage, edits: {}, outputFormat: 'jpeg' });

        assert.equal((await sharp(Buffer.from(result, 'base64')).metadata()).format, 'jpeg');
    });

    it('returns the original bytes when given no edits', async function () {
        const originalImage = await solidImage(4, 4, 'red');
        const result = await new ImageHandler().process({ originalImage });

        assert.deepEqual(Buffer.from(result, 'base64'), originalImage);
    });

    for (const [options, x, y] of [
        [undefined, 2, 2],
        [{ left: '1', top: '1' }, 1, 1],
        [{ left: '-1', top: '-1' }, 3, 3],
        [{ left: '50p', top: '50p' }, 3, 3],
        [{ left: '-50p', top: '-50p' }, 1, 1]
    ]) {
        it(`places a streamed overlay at ${x},${y} with ${JSON.stringify(options)}`, async function () {
            const originalImage = await solidImage(6, 6, 'red');
            const overlay = await solidImage(2, 2, 'blue');
            stubImageDownload().resolves({ Body: { transformToByteArray: async () => new Uint8Array(overlay) } });
            const edits = { overlayWith: { bucket: 'overlays', key: 'watermark.png', options } };
            const result = await new ImageHandler().applyEdits(originalImage, edits);
            const { data, info } = await result.raw().toBuffer({ resolveWithObject: true });

            assert.deepEqual(pixel(data, info, x - 1, y - 1), [255, 0, 0, 255]);
            assert.deepEqual(pixel(data, info, x, y), [0, 0, 255, 255]);
        });
    }

    it('scales the overlay and applies alpha to the image pixels', async function () {
        const overlay = await solidImage(4, 4, 'blue');
        stubImageDownload().resolves({ Body: { transformToByteArray: async () => new Uint8Array(overlay) } });
        const result = await new ImageHandler().getOverlayImage('overlays', 'watermark.png', 50, 50, 20,
            { width: 4, height: 4 });
        const { data, info } = await sharp(result).raw().toBuffer({ resolveWithObject: true });

        assert.deepEqual([info.width, info.height], [2, 2]);
        assert.deepEqual(pixel(data, info, 0, 0), [0, 0, 255, 204]);
    });

    it('reports missing overlay objects using the S3 status and service code', async function () {
        stubImageDownload().rejects({ name: 'NoSuchKey', $metadata: { httpStatusCode: 404 }, message: 'Missing overlay' });

        await assert.rejects(new ImageHandler().getOverlayImage('overlays', 'watermark.png', 50, 50, 20,
            { width: 4, height: 4 }), { status: 404, code: 'NoSuchKey', message: 'Missing overlay' });
    });

    for (const smartCrop of [true, { faceIndex: 0, padding: 0 }]) {
        it(`crops around the detected face for smartCrop ${JSON.stringify(smartCrop)}`, async function () {
            const originalImage = await solidImage(8, 8, 'red');
            detectFace(originalImage);
            const result = await new ImageHandler().applyEdits(originalImage, { smartCrop });
            const { info } = await result.toBuffer({ resolveWithObject: true });

            assert.deepEqual([info.width, info.height], [4, 2]);
        });
    }

    it('reports an out-of-range face index with the existing 400 response', async function () {
        const originalImage = await solidImage(8, 8, 'red');
        detectFace(originalImage);

        await assert.rejects(new ImageHandler().applyEdits(originalImage, { smartCrop: { faceIndex: 2 } }),
            { status: 400, code: 'SmartCrop::FaceIndexOutOfRange' });
    });

    it('reports a face crop whose padding exceeds the source image', async function () {
        const originalImage = await solidImage(8, 8, 'red');
        detectFace(originalImage);

        await assert.rejects(new ImageHandler().applyEdits(originalImage, { smartCrop: { padding: 10 } }),
            { status: 400, code: 'SmartCrop::PaddingOutOfBounds' });
    });

    it('includes requested padding when computing the crop rectangle', function () {
        const box = { Left: 0.55, Top: 0.33, Width: 0.23, Height: 0.18 };
        const area = new ImageHandler().getCropArea(box, { padding: 20 }, { width: 200, height: 400 });

        assert.deepEqual(area, { left: 90, top: 112, width: 86, height: 112 });
    });

    it('reports a Rekognition service error using its code and message', async function () {
        stubFaceDetection().rejects({ name: 'InvalidImageFormatException', $metadata: { httpStatusCode: 400 },
            message: 'Invalid image format' });

        await assert.rejects(new ImageHandler().getBoundingBox(Buffer.from('Not an image'), 0),
            { status: 500, code: 'InvalidImageFormatException', message: 'Invalid image format' });
    });
});
