#!/usr/bin/env bash
# seed-test-users.sh — creates the 5 test accounts shown on the login page (development builds) through the API.
#
# Usage:  bash scripts/seed-test-users.sh                     (API on http://127.0.0.1:4000)
#         API_URL=https://… bash scripts/seed-test-users.sh   (another deployment)
# Accounts that already exist are reported and left alone.

API="${API_URL:-http://127.0.0.1:4000}"

create_user() {
  local EMAIL="$1" PASS="$2" NAME="$3"
  HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"full_name\":\"$NAME\"}" "$API/api/auth/register")
  case "$HTTP" in
    201) echo "  ✅  Created: $NAME <$EMAIL>" ;;
    409) echo "  ·   Exists:  $NAME <$EMAIL>" ;;
    *)   echo "  ⚠️   $EMAIL — HTTP $HTTP" ;;
  esac
}

echo ""
echo "🌱  Seeding 5 test users into $API…"
echo ""
create_user "arjun.sharma@travelsphere.test"  "TravelSphere@2024" "Arjun Sharma"
create_user "priya.nair@travelsphere.test"    "TravelSphere@2024" "Priya Nair"
create_user "rahul.verma@travelsphere.test"   "TravelSphere@2024" "Rahul Verma"
create_user "ananya.iyer@travelsphere.test"   "TravelSphere@2024" "Ananya Iyer"
create_user "kiran.mehta@travelsphere.test"   "TravelSphere@2024" "Kiran Mehta"
echo ""
echo "✨  Done. All accounts use password: TravelSphere@2024"
echo ""
