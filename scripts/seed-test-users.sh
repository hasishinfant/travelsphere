#!/usr/bin/env bash
# seed-test-users.sh
# Creates 5 test accounts in Supabase Auth using the Admin API.
#
# Usage:
#   SUPABASE_URL=https://xxx.supabase.co \
#   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key \
#   bash scripts/seed-test-users.sh
#
# Service Role Key: Supabase Dashboard → Project Settings → API → service_role (Secret)
# Never commit the key. Run once from your terminal.

URL="${SUPABASE_URL:?SUPABASE_URL not set}"
KEY="${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY not set}"

create_user() {
  local EMAIL="$1" PASS="$2" NAME="$3" CITY="$4" ROLE="$5"
  RESP=$(curl -s -w "\n%{http_code}" -X POST \
    -H "apikey: $KEY" \
    -H "Authorization: Bearer $KEY" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"email_confirm\":true,\"user_metadata\":{\"full_name\":\"$NAME\",\"home_city\":\"$CITY\",\"role\":\"$ROLE\"}}" \
    "$URL/auth/v1/admin/users")
  HTTP=$(echo "$RESP" | tail -1)
  BODY=$(echo "$RESP" | head -1)
  if [[ "$HTTP" == "200" || "$HTTP" == "201" ]]; then
    echo "  ✅  Created: $NAME <$EMAIL>"
  else
    MSG=$(python3 -c "import sys,json; d=json.loads('$BODY'); print(d.get('msg','') or d.get('message',''))" 2>/dev/null || echo "$BODY")
    echo "  ⚠️   $EMAIL — HTTP $HTTP — $MSG"
  fi
}

echo ""
echo "🌱  Seeding 5 test users into Supabase…"
echo ""
create_user "arjun.sharma@tbo-test.com"  "TBOtest@2024" "Arjun Sharma"  "Mumbai"    "user"
create_user "priya.nair@tbo-test.com"    "TBOtest@2024" "Priya Nair"    "Bangalore" "user"
create_user "rahul.verma@tbo-test.com"   "TBOtest@2024" "Rahul Verma"   "Delhi"     "user"
create_user "ananya.iyer@tbo-test.com"   "TBOtest@2024" "Ananya Iyer"   "Chennai"   "user"
create_user "kiran.mehta@tbo-test.com"   "TBOtest@2024" "Kiran Mehta"   "Pune"      "admin"
echo ""
echo "✨  Done. All accounts use password: TBOtest@2024"
echo ""
