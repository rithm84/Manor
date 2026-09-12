import { z } from 'zod'

const configurationSchema = z.object({
  supabaseUrl: z.url().refine((url) => url.startsWith('https://') || url.startsWith('http://127.0.0.1:'), 'Supabase requires HTTPS outside local development'),
  supabaseKey: z.string().min(20)
})

export function readConfiguration(): z.infer<typeof configurationSchema> {
  return configurationSchema.parse({
    supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
    supabaseKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  })
}
