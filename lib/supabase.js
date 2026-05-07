import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.[https://yazpmhcdvdbnqwhvrfdp.supabase.co](https://yazpmhcdvdbnqwhvrfdp.supabase.co/)
const supabaseAnonKey = process.env.sb_publishable_GeVAlRU6rJXhyGBN2GXh0Q_oM3OQk7H

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
