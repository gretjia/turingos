const { OpenAI } = require('openai');
const http = require('http');

const server = http.createServer((req, res) => {
  // Never respond to simulate hang
});

server.listen(8081, async () => {
  const client = new OpenAI({ apiKey: 'fake', baseURL: 'http://127.0.0.1:8081', timeout: 5000 });
  const abortController = new AbortController();
  
  setTimeout(() => abortController.abort(), 100);
  
  try {
    await client.chat.completions.create({
      model: 'fake',
      messages: [{role: 'user', content: 'hi'}],
    }, { signal: abortController.signal });
    console.log('fetch resolved');
  } catch (e) {
    console.log('fetch rejected constructor name:', e.constructor.name);
    console.log('errorName:', e.name);
  } finally {
    server.close();
  }
});
