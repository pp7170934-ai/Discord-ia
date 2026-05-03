const http = require('http');

function keepAlive() {
  const port = process.env.PORT || 5000;
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is alive!');
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`Keep-alive server running on port ${port}`);
  });
}

module.exports = keepAlive;
