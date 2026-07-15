const supabaseKeys = Object.keys(process.env).filter(k => k.includes("SUPABASE") || k.includes("DATABASE"));
console.log("Found env keys:", supabaseKeys);
for (const k of supabaseKeys) {
  if (k.includes("KEY") || k.includes("URL")) {
    console.log(`${k}: ${process.env[k] ? 'DEFINED' : 'UNDEFINED'} (length: ${process.env[k]?.length})`);
  }
}
