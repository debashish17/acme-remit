-- Cancel tokens (cx_) need to record which transfer they cancel; confirmation tokens (ct_) keep
-- using quote_id. Kind is the token prefix. session_id holds the caller binding key, since the
-- stateless transport has no MCP session id.
ALTER TABLE confirmations ADD COLUMN transfer_ref TEXT;

CREATE INDEX confirmations_quote ON confirmations (quote_id);
CREATE INDEX transfers_user_created ON transfers (user_id, created_at);
CREATE INDEX transfer_events_ref ON transfer_events (ref, at);
