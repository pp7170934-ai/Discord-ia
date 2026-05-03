const http = require('http');

module.exports = function() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is alive\n');
  });

  const port = process.env.PORT || 3000;
  server.listen(port, () => {
    console.log(`Keep-alive server listening on port ${port}`);
  });
};
