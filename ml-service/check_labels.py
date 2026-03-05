import pandas as pd
from sqlalchemy import create_engine
import os
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path('../.env'))
engine = create_engine(
    f"mysql+pymysql://{os.getenv('DB_USER')}:{os.getenv('DB_PASSWORD')}@{os.getenv('DB_HOST')}/{os.getenv('DB_NAME')}"
)
df = pd.read_sql('SELECT * FROM asset_feature_snapshots WHERE will_fail_30d IS NOT NULL', engine)

def label(row):
    wear         = row.get('mechanical_wear_score', 0) or 0
    neglect      = row.get('neglect_score', 0) or 0
    days_maint   = row.get('days_since_last_maintenance', 0) or 0
    overdue      = row.get('maint_overdue', 0) or 0
    age          = row.get('asset_age_years', 0) or 0
    will_fail    = row.get('will_fail_30d', 0) or 0
    maint_burden = row.get('maint_burden', 0) or 0
    hours        = row.get('total_hours_lifetime', 0) or 0

    # HIGH
    if will_fail == 1 and wear >= 2.0:             return 'HIGH'
    if wear >= 3.5:                                return 'HIGH'
    if neglect >= 3.0 and days_maint > 60:         return 'HIGH'
    if days_maint > 120 and overdue:               return 'HIGH'
    if wear >= 2.5 and neglect >= 2.0 and age >= 3.0: return 'HIGH'
    if hours > 4000 and wear >= 2.5:               return 'HIGH'
    if maint_burden > 3.5 and wear >= 2.0:         return 'HIGH'

    # LOW
    if age < 1.5 and days_maint < 30 and wear < 1.0:    return 'LOW'
    if days_maint < 20 and wear < 0.8 and neglect < 0.5: return 'LOW'
    if hours < 500 and age < 2.0 and neglect < 1.0:     return 'LOW'
    if wear < 0.5 and neglect < 0.5 and not overdue:    return 'LOW'

    return 'MEDIUM'

df['label'] = df.apply(label, axis=1)
counts = df['label'].value_counts()
print(counts)
print(f'Total: {len(df)}')
print(f'\nPercentages:')
for cls, cnt in counts.items():
    print(f'  {cls}: {cnt/len(df)*100:.1f}%')

# Show feature ranges per class to help calibrate thresholds
print('\nFeature means by class:')
print(df.groupby('label')[['mechanical_wear_score','neglect_score','days_since_last_maintenance','asset_age_years','total_hours_lifetime']].mean().round(2))