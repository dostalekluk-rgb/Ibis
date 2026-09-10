import http from 'http';

http.get('http://localhost:3000/chronology.html', res => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('Status code:', res.statusCode);
    console.log('Includes Není načtena žádná:', data.includes('Není načtena žádná'));
    console.log('Includes EXAM-001:', data.includes('EXAM-001'));
  });
});
