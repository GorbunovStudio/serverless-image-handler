const { GetObjectCommand, S3Client } = require('@aws-sdk/client-s3');

const s3 = new S3Client();

async function getImageObject(bucket, key) {
    const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const bytes = await object.Body.transformToByteArray();
    return { ...object, Body: Buffer.from(bytes) };
}

module.exports = getImageObject;
