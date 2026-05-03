const http = require('http');

function keepAlive() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is alive!');
  });

  server.listen(8080, '0.0.0.0', () => {
    console.log('Keep-alive server running on port 8080');
  });
}

module.exports = keepAlive;
