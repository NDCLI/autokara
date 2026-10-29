import importlib.util
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1] / "electron"
SPEC = importlib.util.spec_from_file_location("local_whisper_worker", ROOT / "local-whisper-worker.py")
worker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(worker)


class LocalRuntimeContractTests(unittest.TestCase):
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
        self.assertEqual(packages["faster-whisper"]["versionPolicy"], "vietkara-reference")
        self.assertTrue(packages["av"]["required"])
        self.assertEqual(packages["av"]["testedVersion"], "19.0.1")
        self.assertTrue(packages["ctranslate2"]["required"])
        self.assertEqual(packages["ctranslate2"]["testedVersion"], "4.8.3")
        profile = manifest["runtime"]["testedProfiles"][0]
        self.assertEqual(profile["id"], "vietkara-windows-x64-python-3.12-cpu")
        self.assertEqual(profile["python"], "3.12.10")
        lock_path = ROOT.parent / profile["requirements"]
        locked = set(lock_path.read_text(encoding="utf-8").splitlines())
        self.assertTrue({"faster-whisper==1.2.1", "av==19.0.1", "ctranslate2==4.8.3", "stable-ts==2.19.1"}.issubset(locked))
        self.assertTrue(packages["stable-ts"]["required"])
        self.assertEqual(packages["stable-ts"]["testedVersion"], "2.19.1")
        self.assertNotIn("whisperx", packages)
        self.assertFalse(packages["demucs"]["required"])
        self.assertEqual(packages["demucs"]["requiredWhen"], "vocal-separation-enabled")


if __name__ == "__main__":
    unittest.main()
