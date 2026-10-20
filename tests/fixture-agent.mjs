process.stdout.write('READY\n');
console.log(`CWD:${process.cwd()}`);
process.stdin.once('data', (data) => {
  console.log(`REPLY:${data.toString().trim()}`);
  process.exit(0);
});
