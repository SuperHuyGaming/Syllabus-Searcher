// AWS Lambda entry point, invoked through a Function URL behind CloudFront.
const { createApp } = require('./app');
const { createCatalog } = require('./repos/catalog');
const { createFiles } = require('./repos/files');
const { createUploads } = require('./repos/uploads');

const app = createApp({
  catalog: createCatalog(),
  files: createFiles(),
  uploads: createUploads(),
});

exports.handler = (event) => app(event);
