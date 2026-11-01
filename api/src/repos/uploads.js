// Student uploads wait in a Supabase Postgres table until an admin reviews them.
// Schema: infra/supabase/schema.sql
const { createClient } = require('@supabase/supabase-js');
const config = require('../config');

let shared;
function getSupabase() {
  if (!config.supabaseUrl || !config.supabaseServiceKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  }
  if (!shared) {
    shared = createClient(config.supabaseUrl, config.supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return shared;
}

function unwrap({ data, error }) {
  if (error) throw new Error(`Supabase: ${error.message}`);
  return data;
}

function createUploads({ supabase } = {}) {
  const sb = () => supabase || getSupabase();

  return {
    async create(row) {
      return unwrap(await sb().from('uploads').insert(row).select().single());
    },

    async listPending() {
      return unwrap(
        await sb().from('uploads').select('*').eq('status', 'pending').order('created_at', { ascending: true })
      );
    },

    async get(id) {
      return unwrap(await sb().from('uploads').select('*').eq('id', id).maybeSingle());
    },

    // `changes` holds any course details the admin corrected before approving.
    async review(id, { status, reviewer, note, changes = {} }) {
      return unwrap(
        await sb()
          .from('uploads')
          .update({ ...changes, status, reviewed_by: reviewer, reviewed_at: new Date().toISOString(), note })
          .eq('id', id)
          .eq('status', 'pending')
          .select()
          .maybeSingle()
      );
    },

    // Returns the admin's email, or null if the token isn't a signed-in admin.
    async adminEmail(accessToken) {
      const { data, error } = await sb().auth.getUser(accessToken);
      if (error || !data?.user?.email) return null;
      const email = data.user.email.toLowerCase();
      return config.adminEmails.includes(email) ? email : null;
    },

    async ping() {
      unwrap(await sb().from('uploads').select('id', { head: true, count: 'exact' }).limit(1));
    },
  };
}

module.exports = { createUploads };
