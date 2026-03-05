const { OpenAI } = require('openai');
const http = require('http');

const server = http.createServer((req, res) => {
  // Never respond to simulate hang
});

server.listen(8081, async () => {
  const client = new OpenAI({ apiKey: 'fake', baseURL: 'http://127.0.0.1:8081' });
  const abortController = new AbortController();
  
  setTimeout(() => abortController.abort(), 100);
  
  try {
    await client.chat.completions.create({
      model: 'fake',
      messages: [{role: 'user', content: 'hi'}],
    }, { signal: abortController.signal });
    console.log('fetch resolved');
  } catch (e) {
    console.log('fetch rejected', e.name, e.message);
  } finally {
    server.close();
  }
});
