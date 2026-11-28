"""Historical replay of the assessment logic against independent cyclone records (2022-2024).

Question
  On days when a tropical cyclone actually passed close to a place, would a traveller have been shown a
  favourable ("LOW") assessment? And on quiet days, how often does each method raise the level?

Cases
  Every location-day of the hazard-event dataset (data/ml/hazard_event_dataset.csv.gz): 111 places,
  2022-2024, with ERA5 daily weather and the GDACS orange/red flood or cyclone alerts active within 100 km.

Inputs available to every method (identical for all of them)
  weather severity  daily rain (IMD daily classes) and daily maximum gust (the engine's Beaufort classes)
  active hazards    GDACS orange -> severe, red -> extreme (app/ingestion/gdacs.py ALERT_CLASS)
  remoteness        GeoNames distance to the nearest town of >= 5 000 people (the engine's own bands)
  The other five factors (terrain, emergency access, hazard history, exposure, timing) need online services and
  are unavailable here, exactly as the engine would report them.

Independent ground truth
  IBTrACS best tracks (NOAA NCEI): a day is a "cyclone day" when any hourly fix with >= 34 kt winds lies within
  100 km of the place (>= 64 kt: hurricane-force subset). IBTrACS is not an input to any method. The Dartmouth
  Flood Observatory archive ends in October 2021, so floods cannot be used as ground truth for 2022-2024.

Methods
  composite     equal-weight mean of the available factor values (the engine's ranking index), mapped to the
                shared 5-step scale and then to a level
  max_factor    worst available factor, mapped to a level
  tci_alone     framework TCI (5) over the available dimension ratings, favourable if >= 66 ("High" band),
                shown without the override
  rule_engine   the deployed rules (app/risk_engine/aggregation/category.decide) plus the red-alert override
  Ablations: rule engine without the override; trekking instead of sightseeing.

Usage: python -m app.ml.evaluation.framework_replay      (writes reports/framework_replay.json)
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from functools import lru_cache
from types import SimpleNamespace

import numpy as np
import pandas as pd
from sklearn.neighbors import BallTree

from app.core.config import SERVICE_ROOT
from app.geospatial import settlements
from app.ml.datasets.cyclones import EARTH_KM, interpolate_hourly, load_tracks
from app.risk_engine.aggregation.category import decide
from app.risk_engine.aggregation.config import load_scoring
from app.risk_engine.factors.remoteness import TOWN_POPULATION, VALUE_CAP_KM, remoteness_class
from app.risk_engine.factors.weather_severity import gust_class
from app.schemas.factors import FACTOR_LABELS, SEVERITY_ORDER, SEVERITY_VALUE, FactorResult, max_class

DATASET = SERVICE_ROOT / "data" / "ml" / "hazard_event_dataset.csv.gz"
REPORT = SERVICE_ROOT / "reports" / "framework_replay.json"
RADIUS_KM, TS_KT, HURRICANE_KT = 100, 34, 64
LEVELS = ["LOW", "MODERATE", "HIGH", "CRITICAL"]
TCI_FAVOURABLE = 66          # lower bound of the "High" band of the Tourist Confidence Score
N_BOOT, SEED = 2000, 7
NOW = datetime(2025, 1, 1, tzinfo=timezone.utc)


def rain_day_class(mm: float) -> str:
    """India Meteorological Department daily rainfall categories (moderate 15.6, heavy 64.5, very heavy 115.6,
    extremely heavy 204.5 mm/day), mapped onto the engine's five-step scale."""
    return ("extreme" if mm >= 204.5 else "severe" if mm >= 115.6 else "moderate" if mm >= 64.5
            else "minor" if mm >= 15.6 else "none")


def cyclone_days(locs: pd.DataFrame, start: str, end: str) -> tuple[set, set]:
    """(location_id, date) pairs with a >= 34 kt / >= 64 kt fix within RADIUS_KM, from hourly-interpolated tracks."""
    tr = load_tracks()
    tr = tr[(tr["time"] >= pd.Timestamp(start) - pd.Timedelta(days=2)) & (tr["time"] <= pd.Timestamp(end) + pd.Timedelta(days=2))]
    hourly = interpolate_hourly(tr)
    hourly = hourly[(hourly["wind_kt"] >= TS_KT) & (hourly["time"] >= pd.Timestamp(start))
                    & (hourly["time"] <= pd.Timestamp(end) + pd.Timedelta(hours=23))]
    tree = BallTree(np.radians(locs[["latitude", "longitude"]].to_numpy()), metric="haversine")
    idx = tree.query_radius(np.radians(hourly[["lat", "lon"]].to_numpy()), r=RADIUS_KM / EARTH_KM)
    ts, hu = set(), set()
    days = hourly["time"].dt.date.astype(str).to_numpy()
    wind = hourly["wind_kt"].to_numpy()
    ids = locs["location_id"].to_numpy()
    for i, hits in enumerate(idx):
        for j in hits:
            ts.add((ids[j], days[i]))
            if wind[i] >= HURRICANE_KT:
                hu.add((ids[j], days[i]))
    return ts, hu


def factor(key: str, cls: str | None, value: float | None = None) -> FactorResult:
    if cls is None:
        return FactorResult(key=key, label=FACTOR_LABELS[key], status="unavailable", methodology="replay",
                            explanation="not available in the replay", computed_at=NOW)
    return FactorResult(key=key, label=FACTOR_LABELS[key], status="measured",
                        value=SEVERITY_VALUE[cls] if value is None else value, severity_class=cls,
                        methodology="replay", explanation=f"{key}: {cls}", computed_at=NOW)


@lru_cache(maxsize=None)
def engine_level(weather: str | None, hazard: str | None, remote: str, remote_value: float, activity: str) -> str | None:
    rules = load_scoring()["category"]
    fs = [factor("weather_severity", weather), factor("hazard_severity", hazard),
          factor("remoteness", remote, remote_value)]
    return decide(SimpleNamespace(activity=activity), fs, rules)["category"]


def to_level(value: float) -> str:
    """0-1 risk value -> nearest step of the shared five-step scale -> level (class_to_category)."""
    cls = SEVERITY_ORDER[int(round(min(max(value, 0), 1) * 4))]
    return load_scoring()["category"]["class_to_category"][cls]


def assess(df: pd.DataFrame, hazard_feed: bool = True, extra_calm: int = 0, activity: str = "sightseeing") -> pd.DataFrame:
    """Level per method for every row. `extra_calm` adds that many zero-risk factors to the averaging methods
    (a sensitivity analysis standing in for the five factors that are unavailable offline)."""
    out = pd.DataFrame(index=df.index)
    w = df["weather_cls"].map(lambda c: SEVERITY_VALUE[c] if isinstance(c, str) else np.nan)
    h = df["hazard_cls"].map(SEVERITY_VALUE) if hazard_feed else pd.Series(np.nan, index=df.index)
    r = df["remote_value"]
    vals = pd.concat([w, h, r], axis=1)
    n_avail = vals.notna().sum(axis=1) + extra_calm
    mean = vals.sum(axis=1, skipna=True) / n_avail
    out["composite"] = mean.map(to_level)
    out["max_factor"] = vals.max(axis=1, skipna=True).map(to_level)
    # framework dimension ratings: F3 = 100(1 - u3); F4 by noisy-OR (one active alert per day here, G = T = 1);
    # F8 from remoteness. Equal importance weights; TCI (5) over the available dimensions.
    s = 100 * (1 - vals)
    tci = (s.sum(axis=1, skipna=True) + 100 * extra_calm) / n_avail
    out["tci_value"] = tci
    out["tci_alone"] = np.where(tci >= TCI_FAVOURABLE, "LOW", "MODERATE")      # favourable vs not favourable
    hz = df["hazard_cls"] if hazard_feed else pd.Series([None] * len(df), index=df.index)
    lv = [engine_level(wc if isinstance(wc, str) else None, hc if isinstance(hc, str) else None, rc, rv, activity)
          for wc, hc, rc, rv in zip(df["weather_cls"], hz, df["remote_cls"], df["remote_value"])]
    out["rule_no_override"] = [x if x is not None else "INCOMPLETE" for x in lv]
    red = df["y_red"].astype(bool) if hazard_feed else pd.Series(False, index=df.index)
    out["rule_engine"] = np.where(red & (out["rule_no_override"] != "INCOMPLETE"), "CRITICAL", out["rule_no_override"])
    return out


METHODS = ["composite", "max_factor", "tci_alone", "rule_no_override", "rule_engine"]


def rates(levels: pd.Series, mask: pd.Series) -> dict:
    sel = levels[mask]
    n = int(len(sel))
    if n == 0:
        return {"n": 0}
    return {"n": n,
            "favourable": round(float((sel == "LOW").mean()), 4),
            "elevated": round(float(sel.isin(["MODERATE", "HIGH", "CRITICAL"]).mean()), 4),
            "high_or_critical": round(float(sel.isin(["HIGH", "CRITICAL"]).mean()), 4),
            "critical": round(float((sel == "CRITICAL").mean()), 4)}


def cluster_ci(levels: pd.DataFrame, mask: pd.Series, loc: pd.Series, a: str, b: str | None = None) -> list[float]:
    """95% bootstrap interval, resampling whole places, for the favourable rate of `a` (or the difference a - b)."""
    rng = np.random.default_rng(SEED)
    d = pd.DataFrame({"loc": loc[mask], "a": (levels.loc[mask, a] == "LOW").astype(float)})
    if b:
        d["b"] = (levels.loc[mask, b] == "LOW").astype(float)
    g = d.groupby("loc").agg(["sum", "count"])
    places = g.index.to_numpy()
    stats = []
    for _ in range(N_BOOT):
        pick = rng.choice(places, len(places), replace=True)
        s = g.loc[pick]
        ra = s[("a", "sum")].sum() / s[("a", "count")].sum()
        stats.append(ra - (s[("b", "sum")].sum() / s[("b", "count")].sum() if b else 0))
    return [round(float(np.percentile(stats, 2.5)), 4), round(float(np.percentile(stats, 97.5)), 4)]


def main() -> None:
    df = pd.read_csv(DATASET)
    df = df[df["date"] >= "2022-01-01"].reset_index(drop=True)
    locs = df.groupby("location_id")[["latitude", "longitude"]].first().reset_index()

    # remoteness per place, with the engine's own bands and value scale
    rem = {}
    for _, row in locs.iterrows():
        town = settlements.nearest(row.latitude, row.longitude, TOWN_POPULATION)
        km = town["distance_m"] / 1000 if town else None
        rem[row.location_id] = (remoteness_class(km), round(min(km, VALUE_CAP_KM) / VALUE_CAP_KM, 4)) if km is not None else (None, np.nan)
    df["remote_cls"] = df["location_id"].map(lambda l: rem[l][0])
    df["remote_value"] = df["location_id"].map(lambda l: rem[l][1])

    df["weather_cls"] = [max_class(rain_day_class(p) if pd.notna(p) else None, gust_class(g) if pd.notna(g) else None)
                         for p, g in zip(df["precip"], df["gust"])]
    df["hazard_cls"] = np.where(df["y_red"] == 1, "extreme", np.where(df["y"] == 1, "severe", "none"))

    ts, hu = cyclone_days(locs, df["date"].min(), df["date"].max())
    key = list(zip(df["location_id"], df["date"]))
    df["cyclone"] = [k in ts for k in key]
    df["hurricane"] = [k in hu for k in key]
    quiet = (~df["cyclone"]) & (df["y"] == 0)
    pos = df["cyclone"]

    report = {"generated_at": datetime.now(timezone.utc).isoformat(), "scoring_version": load_scoring()["version"],
              "cases": int(len(df)), "places": int(df["location_id"].nunique()),
              "period": [df["date"].min(), df["date"].max()],
              "cyclone_days": int(pos.sum()), "hurricane_days": int(df["hurricane"].sum()),
              "cyclone_places": int(df.loc[pos, "location_id"].nunique()), "quiet_days": int(quiet.sum()),
              "alert_on_cyclone_days": round(float(df.loc[pos, "y"].mean()), 4),
              "red_alert_on_cyclone_days": round(float(df.loc[pos, "y_red"].mean()), 4),
              "weather_moderate_plus_on_cyclone_days": round(float(df.loc[pos, "weather_cls"].isin(["moderate", "severe", "extreme"]).mean()), 4),
              "remoteness_classes": df.groupby("remote_cls")["location_id"].nunique().to_dict(),
              "coverage_kappa_equal_weights": "3 of 8 dimensions available -> kappa = 0.375 < theta = 0.5: TCI withheld for every case",
              "scenarios": {}}

    def scenario(name, **kw):
        lv = assess(df, **kw)
        res = {m: {"cyclone_days": rates(lv[m], pos), "hurricane_days": rates(lv[m], df["hurricane"]),
                   "quiet_days": rates(lv[m], quiet)} for m in METHODS}
        for m in METHODS:
            res[m]["cyclone_days"]["favourable_ci95"] = cluster_ci(lv, pos, df["location_id"], m)
        for m in ("composite", "max_factor", "tci_alone"):
            res[m]["diff_vs_rule_engine_ci95"] = cluster_ci(lv, pos, df["location_id"], m, "rule_engine")
        res["_mean_tci_on_cyclone_days"] = round(float(lv.loc[pos, "tci_value"].mean()), 1)
        report["scenarios"][name] = res
        print(f"\n== {name}")
        for m in METHODS:
            c, q = res[m]["cyclone_days"], res[m]["quiet_days"]
            print(f"{m:18s} cyclone days favourable {c['favourable']:.3f} {c['favourable_ci95']}  "
                  f"elevated {c['elevated']:.3f}  | quiet days elevated {q['elevated']:.3f}")
        return lv

    scenario("all_inputs_sightseeing")
    scenario("all_inputs_trekking", activity="trekking")
    for k in (1, 2, 3, 4, 5):
        scenario(f"dilution_plus_{k}_calm_factors", extra_calm=k)
    scenario("hazard_feed_missing", hazard_feed=False)

    # missing-data disclosure: with the alert feed down, the engine lists active hazards as unavailable and caps
    # confidence at low (confidence.py); a naive composite that imputes zero risk shows LOW with no caveat.
    lv0 = assess(df, hazard_feed=False)
    naive = pd.concat([df["weather_cls"].map(lambda c: SEVERITY_VALUE[c] if isinstance(c, str) else np.nan),
                       pd.Series(0.0, index=df.index), df["remote_value"]], axis=1).mean(axis=1).map(to_level)
    report["missing_feed"] = {
        "naive_zero_imputation_favourable_on_cyclone_days": round(float((naive[pos] == "LOW").mean()), 4),
        "rule_engine_favourable_on_cyclone_days": round(float((lv0.loc[pos, "rule_engine"] == "LOW").mean()), 4),
        "rule_engine_flagged_low_confidence": 1.0,
        "note": "With active hazards unavailable the engine always reports it as missing and caps confidence at low."}

    REPORT.parent.mkdir(exist_ok=True)
    REPORT.write_text(json.dumps(report, indent=1, default=str))
    print("\n", json.dumps({k: v for k, v in report.items() if k != "scenarios"}, indent=1, default=str))
    print("wrote", REPORT)


if __name__ == "__main__":
    main()
