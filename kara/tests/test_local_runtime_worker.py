import importlib.util
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1] / "electron"
SPEC = importlib.util.spec_from_file_location("local_whisper_worker", ROOT / "local-whisper-worker.py")
worker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(worker)


class LocalRuntimeContractTests(unittest.TestCase):
    def test_alignment_gate_rejects_collapsed_low_score_word_times(self):
        original = {"start": 12.0, "end": 20.0}
        collapsed = [
            {"start": 0.0, "end": 0.08, "score": 0.01},
            {"start": 0.1, "end": 0.18, "score": 0.01},
        ]
        self.assertFalse(worker.aligned_words_are_usable(original, collapsed, 2))

    def test_alignment_gate_accepts_supported_words_inside_source_segment(self):
        original = {"start": 12.0, "end": 20.0}
        aligned = [
            {"start": 12.2, "end": 12.6, "score": 0.82},
            {"start": 13.0, "end": 13.6, "score": 0.74},
        ]
        self.assertTrue(worker.aligned_words_are_usable(original, aligned, 2))

    def test_alignment_gate_rejects_out_of_bounds_alignment(self):
        original = {"start": 12.0, "end": 20.0}
        aligned = [{"start": 19.0, "end": 20.7, "score": 0.9}]
        self.assertFalse(worker.aligned_words_are_usable(original, aligned, 1))

    def test_segment_bounds_expand_to_enclose_word_timestamps(self):
        words = [{"start": 4.8, "end": 5.1}, {"start": 5.1, "end": 6.2}]
        self.assertEqual(worker.enclose_segment_words(4.9, 6.0, words), (4.8, 6.2))
        self.assertEqual(worker.enclose_segment_words(4.9, 6.0, []), (4.9, 6.0))

    def test_manifest_supported_versions_match_range_boundaries(self):
        manifest = json.loads((ROOT / "local-runtime-manifest.json").read_text(encoding="utf-8"))
        supported = manifest["runtime"]["python"]["supported"]
        self.assertEqual(supported, ["3.10", "3.11", "3.12"])
        self.assertTrue(all(worker.supported_python_version(tuple(map(int, version.split(".")))) for version in supported))
        self.assertTrue(worker.supported_python_version((3, 10, 0)))
        self.assertTrue(worker.supported_python_version((3, 11, 9)))
        self.assertTrue(worker.supported_python_version((3, 12, 99)))
        self.assertFalse(worker.supported_python_version((3, 9, 9)))
        self.assertFalse(worker.supported_python_version((3, 13, 0)))
        self.assertFalse(worker.supported_python_version((3, 15, 0)))

    def test_package_policy_records_the_verified_host_combination(self):
        manifest = json.loads((ROOT / "local-runtime-manifest.json").read_text(encoding="utf-8"))
        packages = manifest["runtime"]["packages"]
        self.assertTrue(packages["faster-whisper"]["required"])
        self.assertEqual(packages["faster-whisper"]["testedVersion"], "1.2.1")
        self.assertEqual(packages["faster-whisper"]["versionPolicy"], "tested-on-python-3.12-windows-cpu")
        self.assertTrue(packages["av"]["required"])
        self.assertEqual(packages["av"]["testedVersion"], "19.0.2")
        self.assertTrue(packages["ctranslate2"]["required"])
        self.assertEqual(packages["ctranslate2"]["testedVersion"], "4.8.4")
        profile = manifest["runtime"]["testedProfiles"][0]
        self.assertEqual(profile["id"], "windows-x64-python-3.12-cpu")
        self.assertEqual(profile["python"], "3.12.10")
        lock_path = ROOT.parent / profile["requirements"]
        locked = set(lock_path.read_text(encoding="utf-8").splitlines())
        self.assertTrue({"faster-whisper==1.2.1", "av==19.0.2", "ctranslate2==4.8.4"}.issubset(locked))
        self.assertFalse(packages["whisperx"]["required"])
        self.assertEqual(packages["whisperx"]["requiredWhen"], "forced-alignment-enabled")
        self.assertFalse(packages["demucs"]["required"])
        self.assertEqual(packages["demucs"]["requiredWhen"], "vocal-separation-enabled")


if __name__ == "__main__":
    unittest.main()
