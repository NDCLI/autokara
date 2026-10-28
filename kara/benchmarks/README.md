# Alignment benchmark

Run `npm run benchmark:alignment -- path/to/dataset.json [report.json]`.
The runner evaluates the current lyric-to-ASR alignment stage. It does not run
ASR or measure provider/model time. Record the ASR output once, then reuse the
same transcript when comparing alignment revisions.

To assemble local ASR snapshots with the Vietnamese word-timestamp metadata
from [sunbv56/song_dataset_chunked](https://huggingface.co/datasets/sunbv56/song_dataset_chunked), run:

```bash
npm run benchmark:import-viet-songs -- metadata.jsonl asr-snapshots.jsonl song-split.json heldout heldout.json
```

The importer does not download audio or follow the source's streaming URLs.
`asr-snapshots.jsonl` contains one object per chunk with a normalized
`transcript.segments` array; ASR times must be relative to that chunk. The split
map is a JSON object from every `song_id` in the metadata file to `tuning` or
`heldout`, so chunks from one song cannot cross splits. The importer subtracts
`chunk_start_ms` from reference word times, checks lyric/word counts and bounds,
and records source, split, and `referenceStatus: external-unverified` in the
result and report.

The Hugging Face card declares Apache-2.0 for its hosted dataset metadata, but
its records point to external streaming audio. The importer intentionally keeps
those URLs out of the benchmark. Source word timing labels have not been
independently reviewed here; reports from this import are exploratory until a
human has checked the reference words against authorized local audio. Do not
use them as a model-quality claim or default-provider gate.

Use `npm run benchmark:alignment:scaling` to measure compute scaling on a
generated synthetic transcript (100, 300, 600 and 1000 lines by default). It
warms the runner, takes three measurements and reports their median for the
current and frozen legacy matchers. This fixture measures alignment compute
only and must not be used as evidence of timing accuracy on real songs.

Use one `samples[]` entry per song/clip. Keep songs in only one split (tuning or
held-out evaluation). For each line, include the lyrics and any timing anchors
available to the engine. `referenceWords` must contain manually checked onset
and offset for each audible Vietnamese lyric syllable, with zero-based
`lineIndex`. Mark uncertain annotations in a separate review log and exclude
them consistently; do not silently omit difficult words.

```json
{
  "name": "held-out-solo-clear-lyrics-v1",
  "samples": [
    {
      "id": "song-001-chorus-1",
      "duration": 24.0,
      "lines": [{ "text": "Mình cùng hát vang", "start": 8.1, "end": 10.2 }],
      "transcript": {
        "segments": [{
          "id": "asr-1",
          "text": "Mình cùng hát vang",
          "start": 8.0,
          "end": 10.3,
          "confidence": 0.9,
          "words": [
            { "id": "w1", "text": "Mình", "start": 8.14, "end": 8.45, "confidence": 0.9 },
            { "id": "w2", "text": "cùng", "start": 8.55, "end": 8.92, "confidence": 0.9 },
            { "id": "w3", "text": "hát", "start": 9.1, "end": 9.42, "confidence": 0.9 },
            { "id": "w4", "text": "vang", "start": 9.55, "end": 10.1, "confidence": 0.9 }
          ]
        }]
      },
      "referenceWords": [
        { "lineIndex": 0, "text": "Mình", "start": 8.12, "end": 8.47 },
        { "lineIndex": 0, "text": "cùng", "start": 8.54, "end": 8.95 },
        { "lineIndex": 0, "text": "hát", "start": 9.08, "end": 9.45 },
        { "lineIndex": 0, "text": "vang", "start": 9.53, "end": 10.12 }
      ]
    }
  ]
}
```

The report includes the current matcher and a frozen copy of the pre-rewrite
matcher, evaluated against the same annotations. It writes both metric sets and
a signed current-minus-baseline delta (negative timing/error counts are better;
positive evidence coverage is better). The baseline is for regression
comparison, not an external quality standard.
Repeated-line occurrence misses are measured from the matcher's selected ASR
window before lyric-anchor clamping, so a line anchor cannot hide a wrong
chorus occurrence. The manually labeled `referenceWords` still define the
expected occurrence and must contain every repeated occurrence separately.

Each report includes onset/offset median and P90 (linear-interpolated quantiles),
counts and rates inside ±100/±200 ms, evidence-backed timing coverage (`manual`
origins), model-aligned timing words (`aligned` origins), and unverified timing
words (`asr` or `estimated` origins),
text mismatches, repeated-line occurrence misses
(predicted first word more than 2 s from the labeled first word for repeated
lyric text), and alignment compute time divided by clip duration. It reports
both pooled word-level metrics and equal-weight macro summaries built from each
sample's onset/offset median, so long samples do not dominate every headline
metric. Each sample also includes its own timing summaries. This ratio excludes
audio decoding, ASR, model loading and provider/network time. Run a larger
held-out set before using the figures as a quality gate. The example schema
above is illustrative, not a benchmark result.
