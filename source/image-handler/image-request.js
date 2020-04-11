/*********************************************************************************************************************
 *  Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved.                                           *
 *                                                                                                                    *
 *  Licensed under the Apache License, Version 2.0 (the "License"). You may not use this file except in compliance    *
 *  with the License. A copy of the License is located at                                                             *
 *                                                                                                                    *
 *      http://www.apache.org/licenses/LICENSE-2.0                                                                    *
 *                                                                                                                    *
 *  or in the 'license' file accompanying this file. This file is distributed on an 'AS IS' BASIS, WITHOUT WARRANTIES *
 *  OR CONDITIONS OF ANY KIND, express or implied. See the License for the specific language governing permissions    *
 *  and limitations under the License.                                                                                *
 *********************************************************************************************************************/

const ThumborMapping = require('./thumbor-mapping');

class ImageRequest {

    /**
     * Initializer function for creating a new image request, used by the image
     * handler to perform image modifications.
     * @param {Object} event - Lambda request body.
     */
    async setup(event) {
        try {
            this.requestType = this.parseRequestType(event);
            this.bucket = this.parseImageBucket(event, this.requestType);
            this.key = this.parseImageKey(event, this.requestType);
            this.edits = this.parseImageEdits(event, this.requestType);
            this.originalImage = await this.getOriginalImage(this.bucket, this.key);

            /* Decide the output format of the image.
             * 1) If the format is provided, the output format is the provided format.
             * 2) If headers contain "Accept: image/webp", the output format is webp.
             * 3) Use the default image format for the rest of cases.
             */
            let outputFormat = this.getOutputFormat(event, this.edits);
            if (this.edits && this.edits.toFormat) {
                this.outputFormat = this.edits.toFormat;
            } else if (outputFormat) {
                this.outputFormat = outputFormat;
            }

            // Fix quality for Thumbor and Custom request type if outputFormat is different from quality type.
            if (this.outputFormat) {
                const requestType = ['Custom', 'Thumbor'];
                const acceptedValues = ['jpeg', 'png', 'webp', 'tiff', 'heif'];

                this.ContentType = `image/${this.outputFormat}`;
                if (requestType.includes(this.requestType) && acceptedValues.includes(this.outputFormat)) {
                    let qualityKey = Object.keys(this.edits).filter(key => acceptedValues.includes(key))[0];
                    if (qualityKey && (qualityKey !== this.outputFormat)) {
                        const qualityValue = this.edits[qualityKey];
                        this.edits[this.outputFormat] = qualityValue;
                        delete this.edits[qualityKey];
                    }
                }
            }

            return Promise.resolve(this);
        } catch (err) {
            return Promise.reject(err);
        }
    }

    /**
     * Gets the original image from an Amazon S3 bucket.
     * @param {String} bucket - The name of the bucket containing the image.
     * @param {String} key - The key name corresponding to the image.
     * @return {Promise} - The original image or an error.
     */
    async getOriginalImage(bucket, key) {
        const S3 = require('aws-sdk/clients/s3');
        const s3 = new S3();
        const imageLocation = { Bucket: bucket, Key: key };
        try {
            const originalImage = await s3.getObject(imageLocation).promise();

            if (originalImage.ContentType) {
                this.ContentType = originalImage.ContentType;
            } else {
                this.ContentType = "image";
            }

            if (originalImage.Expires) {
                this.Expires = new Date(originalImage.Expires).toUTCString();
            }

            if (originalImage.LastModified) {
                this.LastModified = new Date(originalImage.LastModified).toUTCString();
            }

            if (originalImage.CacheControl) {
                this.CacheControl = originalImage.CacheControl;
            } else {
                this.CacheControl = "max-age=31536000,public";
            }

            return Promise.resolve(originalImage.Body);
        } catch(err) {
            return Promise.reject({
                status: ('NoSuchKey' === err.code) ? 404 : 500,
                code: err.code,
                message: err.message
            });
        }
    }

    /**
     * Parses the name of the appropriate Amazon S3 bucket to source the
     * original image from.
     * @param {String} event - Lambda request body.
     * @param {String} requestType - Image handler request type.
     */
    parseImageBucket(event, requestType) {
        if (requestType === "Default") {

            let path = this.removePathPrefix(event["path"]);

            const bucket = path.split("/")[0];

            // Decode the image request
            if (bucket !== "") {
                // Check the provided bucket against the whitelist
                const sourceBuckets = this.getAllowedSourceBuckets();
                if (sourceBuckets.includes(bucket) || bucket.match(new RegExp('^' + sourceBuckets[0] + '$'))) {
                    return bucket;
                } else {
                    throw ({
                        status: 403,
                        code: 'ImageBucket::CannotAccessBucket',
                        message: 'The bucket you specified could not be accessed. Please check that the bucket is specified in your SOURCE_BUCKETS.'
                    });
                }
            } else {
                // Try to use the default image source bucket env var
                const sourceBuckets = this.getAllowedSourceBuckets();
                return sourceBuckets[0];
            }
        } else {
            throw ({
                status: 404,
                code: 'ImageBucket::CannotFindBucket',
                message: 'The bucket you specified could not be found. Please check the spelling of the bucket name in your request.'
            });
        }
    }

    /**
     * Parses the edits to be made to the original image.
     * @param {String} event - Lambda request body.
     * @param {String} requestType - Image handler request type.
     */
    parseImageEdits(event, requestType) {
        if (requestType === "Default") {

            if (event['queryStringParameters'] == null) {
                return {};
            }

            const rawData = event['queryStringParameters']['edits'];

            const decoded = this.decodeRequest(rawData);

            if (decoded == null) {
                return {};
            }

            return decoded;
        } else {
            throw ({
                status: 400,
                code: 'ImageEdits::CannotParseEdits',
                message: 'The edits you provided could not be parsed. Please check the syntax of your request and refer to the documentation for additional guidance.'
            });
        }
    }

    /**
     * Parses the name of the appropriate Amazon S3 key corresponding to the
     * original image.
     * @param {String} event - Lambda request body.
     * @param {String} requestType - Type, either "Default", "Thumbor", or "Custom".
     */
    parseImageKey(event, requestType) {
        let key = "";
        if (requestType === "Default") {
            let path = this.removePathPrefix(event["path"]);

            let cleanPath = path.split("#")[0];
            cleanPath = cleanPath.split("?")[0];

            key = cleanPath.split("/").slice(1).join("/");
            
        } 

        if (key === "") {
            // Return an error for all other conditions
            throw ({
                status: 404,
                code: 'ImageEdits::CannotFindImage',
                message: 'The image you specified could not be found. Please check your request syntax as well as the bucket you specified to ensure it exists.'
            });
        }

        return key;
    }

    /**
     * Determines how to handle the request being made based on the URL path
     * prefix to the image request. Categorizes a request as either "image"
     * (uses the Sharp library), "thumbor" (uses Thumbor mapping), or "custom"
     * (uses the rewrite function).
     * @param {Object} event - Lambda request body.
    */
    parseRequestType(event) {
        return 'Default';        
    }

    removePathPrefix(path) {
        const prefix = process.env.PATH_PREFIX;
        const re = new RegExp(`^(${prefix})`);
        return path.replace(re, '');
    }

    /**
     * Decodes the base64-encoded image request path associated with default
     * image requests. Provides error handling for invalid or undefined path values.
     * @param {Object} event - The proxied request object.
     */
    decodeRequest(encoded) {
        if (encoded == null) { 
            return undefined;
        }

        const toBuffer = Buffer.from(encoded, 'base64');
        try {
            // To support European characters, 'ascii' was removed.
            return JSON.parse(toBuffer.toString());
        } catch (e) {
            throw ({
                status: 400,
                code: 'DecodeRequest::CannotDecodeRequest',
                message: 'The image request you provided could not be decoded. Please check that your request is base64 encoded properly and refer to the documentation for additional guidance.'
            });
        }
    }

    /**
     * Returns a formatted image source bucket whitelist as specified in the
     * SOURCE_BUCKETS environment variable of the image handler Lambda
     * function. Provides error handling for missing/invalid values.
     */
    getAllowedSourceBuckets() {
        const sourceBuckets = process.env.SOURCE_BUCKETS;
        if (sourceBuckets === undefined) {
            throw ({
                status: 400,
                code: 'GetAllowedSourceBuckets::NoSourceBuckets',
                message: 'The SOURCE_BUCKETS variable could not be read. Please check that it is not empty and contains at least one source bucket, or multiple buckets separated by commas. Spaces can be provided between commas and bucket names, these will be automatically parsed out when decoding.'
            });
        } else {
            const formatted = sourceBuckets.replace(/\s+/g, '');
            const buckets = formatted.split(',');
            return buckets;
        }
    }

    /**
    * Return the output format depending on the accepts headers and request type
    * @param {Object} event - The request body.
    * @param {Object} edits - The list of edits.
    */
    getOutputFormat(event, edits) {
        const autoWebP = process.env.AUTO_WEBP;
        if (autoWebP && event.headers.Accept && event.headers.Accept.includes('image/webp')) {
            return 'webp';
        } else if (this.requestType === 'Default') {            
            return edits.outputFormat;
        }

        return null;
    }
}

// Exports
module.exports = ImageRequest;