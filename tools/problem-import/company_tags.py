"""Normalize a pinned directory of public company CSVs against official URL identities."""
from __future__ import annotations
import argparse
import csv
import json
import pathlib
import re
from collections import defaultdict
from datetime import date
from urllib.parse import urlparse

WINDOWS = {'thirty-days.csv': '30d', 'three-months.csv': '3m', 'six-months.csv': '6m', 'more-than-six-months.csv': 'older_than_6m', 'all.csv': 'all'}
REQUIRED_COLUMNS = {'ID', 'URL', 'Title', 'Difficulty', 'Acceptance %', 'Frequency %'}


def url_slug(value: str) -> str | None:
    parsed = urlparse(value)
    match = re.fullmatch(r'/problems/([a-z0-9-]+)/?', parsed.path)
    if parsed.scheme != 'https' or parsed.hostname not in {'leetcode.com', 'www.leetcode.com'} or parsed.query or parsed.fragment or match is None:
        return None
    return match.group(1)


def percentage(value: str, path: pathlib.Path, line: int) -> float | None:
    if value.strip() in {'', '-'}:
        return None
    if re.fullmatch(r'\d+(?:\.\d+)?%', value.strip()) is None:
        raise ValueError(f'Invalid percentage at {path}:{line}: {value!r}')
    number = float(value.strip()[:-1])
    if not 0 <= number <= 100:
        raise ValueError(f'Percentage outside 0..100 at {path}:{line}: {value!r}')
    return number


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    for option in ['directory', 'stock', 'companies', 'source-url', 'snapshot-date', 'revision', 'out', 'audit']:
        parser.add_argument('--' + option, required=True)
    args = parser.parse_args()
    date.fromisoformat(args.snapshot_date)
    if re.fullmatch('[a-f0-9]{40}', args.revision) is None:
        raise ValueError('Pin the source to a complete 40-character Git commit')
    stock = json.loads(pathlib.Path(args.stock).read_text())
    by_slug = {row['titleSlug']: row for row in stock}
    if len(by_slug) != len(stock):
        raise ValueError('Official stock metadata repeats a canonical slug')
    company_data = json.loads(pathlib.Path(args.companies).read_text())['companies']
    names = {row['id']: row['name'] for row in company_data}
    for row in company_data:
        names[re.sub('[^a-z0-9]+', '-', row['name'].lower()).strip('-')] = row['name']
    reports: dict[str, list[dict[str, str | float | None]]] = defaultdict(list)
    memberships: dict[str, set[str]] = defaultdict(set)
    unmatched: list[dict[str, str | int]] = []
    title_disagreements: list[dict[str, str]] = []
    source_companies: set[str] = set()
    seen: set[tuple[str, str, str]] = set()
    rows = 0
    for company_dir in sorted(pathlib.Path(args.directory).iterdir()):
        if not company_dir.is_dir():
            continue
        files = sorted(company_dir.glob('*.csv'))
        if not files:
            continue
        company = names.get(company_dir.name, company_dir.name.replace('-', ' ').title())
        source_companies.add(company)
        for path in files:
            if path.name not in WINDOWS:
                raise ValueError(f'Unrecognized company reporting window: {path}')
            window = WINDOWS[path.name]
            with path.open(newline='', encoding='utf-8-sig') as stream:
                reader = csv.DictReader(stream)
                if reader.fieldnames is None or set(reader.fieldnames) != REQUIRED_COLUMNS:
                    raise ValueError(f'Unexpected CSV columns: {path}: {reader.fieldnames}')
                for line, row in enumerate(reader, 2):
                    rows += 1
                    slug = url_slug(row['URL'])
                    official = by_slug.get(slug)
                    if official is None or official['questionFrontendId'] != row['ID']:
                        unmatched.append({'path': str(path.relative_to(args.directory)), 'line': line, 'id': row['ID'], 'url': row['URL'], 'reason': 'URL missing from official catalog' if official is None else 'Official URL and number disagree'})
                        continue
                    if official['title'] != row['Title']:
                        title_disagreements.append({'slug': slug, 'official': official['title'], 'reported': row['Title']})
                    key = (slug, company, window)
                    if key in seen:
                        raise ValueError(f'Duplicate company/URL/window row: {path}:{line}')
                    seen.add(key)
                    memberships[slug].add(company)
                    reports[slug].append({'company': company, 'window': window, 'frequency': percentage(row['Frequency %'], path, line), 'acceptance': percentage(row['Acceptance %'], path, line), 'snapshotDate': args.snapshot_date, 'sourceUrl': args.source_url, 'sourceRevision': args.revision})
    records = [{'url': f'https://leetcode.com/problems/{slug}/', 'companies': sorted(memberships[slug]), 'companyReports': sorted(reports[slug], key=lambda item: (item['company'], item['window']))} for slug in sorted(reports)]
    result = {'version': 1, 'source': {'sourceUrl': args.source_url, 'snapshotDate': args.snapshot_date, 'revision': args.revision}, 'records': records}
    audit = {'version': 1, 'source': result['source'], 'rows': rows, 'acceptedRows': len(seen), 'companies': len(source_companies), 'stockProblemsWithCompanies': len(records), 'memberships': sum(len(value) for value in memberships.values()), 'maxCompaniesPerProblem': max(map(len, memberships.values())), 'unmatched': unmatched, 'titleDisagreements': title_disagreements, 'note': 'Windows are relative to the recorded dataset snapshot; they are not exact last-asked dates.'}
    pathlib.Path(args.out).write_text(json.dumps(result, ensure_ascii=False))
    pathlib.Path(args.audit).write_text(json.dumps(audit, ensure_ascii=False, indent=2))
    for output in [args.out, args.audit]:
        pathlib.Path(output).chmod(0o600)
    print(json.dumps({key: value for key, value in audit.items() if key not in {'source', 'unmatched', 'titleDisagreements', 'note'}} | {'unmatchedRows': len(unmatched), 'titleDisagreements': len(title_disagreements)}))


if __name__ == '__main__':
    main()
