import { createClient } from "@supabase/supabase-js";

export const handler = async () => {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { count, error } = await supabase
    .from("model_picks")
    .select("*", { count: "exact", head: true })
    .eq("result", "pending");

  if (error) {
    throw new Error(error.message);
  }

  return { pendingPicks: count };
};
