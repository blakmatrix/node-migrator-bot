// cmd/file.js
var file = module.exports = function file (filename, cb) {
  this.log.info('High five to ' + filename + '!');
  cb(null);
};