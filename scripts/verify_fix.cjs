const https = require('https');
const crypto = require('crypto');
const fs = require('fs');

const API_ENDPOINT = 'https://pu9tefmfrg.execute-api.ap-east-1.amazonaws.com';
const USERNAME = 'testuser';
const PASSWORD = 'password';
const PACKAGE_NAME = 'testpkg';
const PACKAGE_VERSION = '1.0.0';
const PACKAGE_USER = 'testuser';
const PACKAGE_CHANNEL = 'testing';
const FILE_NAME = 'conan_package.tgz';
const DUMMY_CONTENT = Buffer.from('test_package_content');

function request(method, path, headers = {}, body = null) {
    return new Promise((resolve, reject) => {
        const url = `${API_ENDPOINT}${path}`;
        const options = {
            method,
            headers
        };

        const req = https.request(url, options, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                try {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve({ statusCode: res.statusCode, headers: res.headers, body: data ? JSON.parse(data) : null });
                    } else {
                        console.error(`Request failed: ${method} ${path} -> ${res.statusCode}`, data);
                        reject(new Error(`Status ${res.statusCode}: ${data}`));
                    }
                } catch (e) {
                    resolve({ statusCode: res.statusCode, headers: res.headers, body: data });
                }
            });
        });

        req.on('error', (e) => {
            reject(e);
        });

        if (body) {
            req.write(JSON.stringify(body));
        }
        req.end();
    });
}

function verifyUrl(url, description) {
    console.log(`Verifying ${description} URL:`, url);
    if (url.includes('cloudfront.net')) {
        console.log('✅ URL uses CloudFront domain.');
    } else if (url.includes('s3.amazonaws.com') || url.includes('.s3.')) {
        console.error('❌ URL uses S3 domain directly!');
        throw new Error('S3 domain detected instead of CloudFront');
    } else {
        console.log('⚠️ URL domain suspicious:', url);
    }
}

async function runTest() {
    try {
        console.log('Starting verification test...');

        // 1. Authenticate
        console.log('Authenticating...');
        const authRes = await request('POST', '/v1/users/authenticate', { 'Content-Type': 'application/json' }, { username: USERNAME, password: PASSWORD });
        const token = authRes.body.token;
        console.log('Token obtained:', token);

        // 2. Get Upload URL for Recipe (testpkg/1.0.0/testuser/testing)
        console.log('Getting upload URLs for recipe...');
        const uploadUrlRes = await request('POST', `/v1/conans/${PACKAGE_NAME}/${PACKAGE_VERSION}/${PACKAGE_USER}/${PACKAGE_CHANNEL}/upload_urls`,
            { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            { files: [FILE_NAME] } // requesting conan_package.tgz inside upload_urls? usually this is for manifest/conanfile.py?
            // Wait, Recipe upload is usually conanfile.py, conanmanifest.txt
            // Binary upload is usually conan_package.tgz
            // But let's check both paths.
        );
        // Recipe usually doesn't have conan_package.tgz but let's see if server allows arbitrary filenames in upload_urls Request.
        // Yes, server takes `files` list.

        // Check Recipe URL logic
        const recipeUploadUrl = uploadUrlRes.body[FILE_NAME];
        verifyUrl(recipeUploadUrl, 'Recipe Upload');

        // 3. Get Upload URL for "Binary Package"
        const BIN_ID = 'pkg123';
        console.log('Getting upload URLs for binary package...');
        const pkgUploadUrlRes = await request('POST', `/v1/conans/${PACKAGE_NAME}/${PACKAGE_VERSION}/${PACKAGE_USER}/${PACKAGE_CHANNEL}/packages/${BIN_ID}/upload_urls`,
            { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            { files: [FILE_NAME] }
        );
        const pkgUploadUrl = pkgUploadUrlRes.body[FILE_NAME];
        verifyUrl(pkgUploadUrl, 'Binary Package Upload');

        // 4. Test Actual Upload (PUT) to the signed URL
        console.log('Testing PUT upload to signed URL...');
        // Use raw https/http request to the signed URL
        await new Promise((resolve, reject) => {
            const u = new URL(pkgUploadUrl);
            const opts = {
                method: 'PUT',
                headers: {
                    'Content-Length': DUMMY_CONTENT.length,
                    // Simulate Conan Client behavior: sending Auth header matching the repository URL (or assuming it should)
                    // The error report confirms client sends it.
                    'Authorization': `Bearer ${token}`
                }
            };
            const req = https.request(u, opts, (res) => {
                console.log(`Upload Status: ${res.statusCode}`);
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    if (res.statusCode === 200) {
                        console.log('✅ Upload successful!');
                        resolve();
                    } else {
                        console.error('Upload Error Body:', body);
                        reject(new Error(`Upload failed with status ${res.statusCode}`));
                    }
                });
            });
            req.on('error', reject);
            req.write(DUMMY_CONTENT);
            req.end();
        });

        console.log('🎉 Verification COMPLETE: CloudFront upload path is working.');

    } catch (error) {
        console.error('Test FAILED:', error);
        process.exit(1);
    }
}

runTest();
