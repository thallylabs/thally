// Serve /.well-known/llms.txt with the same body as /llms.txt so agents and
// crawlers can discover the index at the emerging well-known location. Single
// source of truth — re-exports the /llms.txt handler.
export { GET } from '@/app/llms.txt/route'
