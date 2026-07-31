import { supabase } from "./supabaseClient";

export function productPhotoUrl(imagePath: string | null): string | null {
  if (!imagePath) return null;
  return supabase.storage.from("product-images").getPublicUrl(imagePath).data.publicUrl;
}
