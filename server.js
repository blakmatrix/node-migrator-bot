var spawn = require('child_process').spawn,
    http = require('http'),
    path = require('path');

var server = http.createServer(function (req, res) {
  res.setHeader(302, { 'Location': 'http://github.com/blakmatrix/node-migrator-bot' });
  res.end('Redirecting you to the github page for this project!');
});

// Start the npm running.
var bot = spawn('node', [
  path.resolve(__dirname, 'app.js'),
  'npm'
]);

bot.stdout.pipe(process.stdout);
bot.stderr.pipe(process.stderr);

server.listen(8080);
