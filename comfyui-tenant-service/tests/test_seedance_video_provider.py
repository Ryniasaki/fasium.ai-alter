from base64 import b64decode
from types import SimpleNamespace
import unittest

from app.services.seedance_video_provider import SeedanceVideoProvider, SeedanceVideoProviderError


class SeedanceVideoProviderTests(unittest.IsolatedAsyncioTestCase):
    async def test_reference_mode_builds_ark_task_payload(self) -> None:
        provider = SeedanceVideoProvider.__new__(SeedanceVideoProvider)
        provider.settings = SimpleNamespace(
            seedance_api_key="test-key",
            seedance_api_base_url="https://ark.cn-beijing.volces.com/api/v3",
            seedance_model_id="doubao-seedance-2-0-260128",
        )
        provider.api_key = "test-key"
        provider.base_url = "https://ark.cn-beijing.volces.com/api/v3"
        provider.model_id = "doubao-seedance-2-0-260128"

        captured: dict[str, object] = {}

        async def fake_request_json(method: str, path: str, *, json_body=None):
            captured["method"] = method
            captured["path"] = path
            captured["json_body"] = json_body
            return {"id": "cgt-123"}

        provider._request_json = fake_request_json  # type: ignore[attr-defined]

        tiny_png = b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6pGZkAAAAASUVORK5CYII="
        )

        result = await SeedanceVideoProvider.create_video_task(
            provider,
            prompt="let the model turn around",
            duration=5,
            resolution="720P",
            input_images=(("reference.png", tiny_png, "image/png"),),
            mode="reference",
            aspect_ratio="auto",
        )

        self.assertEqual(result["task_id"], "cgt-123")
        self.assertEqual(result["model"], "Seedance 2.0")
        self.assertEqual(result["billing_model"], "ark:doubao-seedance-2-0-260128")
        self.assertEqual(captured["method"], "POST")
        self.assertEqual(captured["path"], "/contents/generations/tasks")
        payload = captured["json_body"]
        self.assertIsInstance(payload, dict)
        self.assertEqual(payload["model"], "doubao-seedance-2-0-260128")
        self.assertEqual(payload["duration"], 5)
        self.assertEqual(payload["resolution"], "720p")
        self.assertTrue(payload["generate_audio"] is False)
        self.assertTrue(payload["watermark"] is True)
        self.assertEqual(len(payload["content"]), 2)
        self.assertEqual(payload["content"][0]["type"], "text")
        self.assertEqual(payload["content"][1]["role"], "reference_image")
        self.assertTrue(payload["content"][1]["image_url"]["url"].startswith("data:image/png;base64,"))

    async def test_resolution_is_normalized_for_seedance(self) -> None:
        provider = SeedanceVideoProvider.__new__(SeedanceVideoProvider)
        provider.settings = SimpleNamespace(
            seedance_api_key="test-key",
            seedance_api_base_url="https://ark.cn-beijing.volces.com/api/v3",
            seedance_model_id="doubao-seedance-2-0-260128",
        )
        provider.api_key = "test-key"
        provider.base_url = "https://ark.cn-beijing.volces.com/api/v3"
        provider.model_id = "doubao-seedance-2-0-260128"

        captured: dict[str, object] = {}

        async def fake_request_json(method: str, path: str, *, json_body=None):
            captured["json_body"] = json_body
            return {"id": "cgt-456"}

        provider._request_json = fake_request_json  # type: ignore[attr-defined]

        tiny_png = b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6pGZkAAAAASUVORK5CYII="
        )

        result = await SeedanceVideoProvider.create_video_task(
            provider,
            prompt="spin around",
            duration=10,
            resolution="1080P",
            input_images=(("reference.png", tiny_png, "image/png"),),
            mode="reference",
            aspect_ratio="16:9",
        )

        self.assertEqual(result["resolution"], "1080p")
        payload = captured["json_body"]
        self.assertIsInstance(payload, dict)
        self.assertEqual(payload["resolution"], "1080p")

    async def test_reference_mode_rejects_non_reference_workflows(self) -> None:
        provider = SeedanceVideoProvider.__new__(SeedanceVideoProvider)
        provider.settings = SimpleNamespace(
            seedance_api_key="test-key",
            seedance_api_base_url="https://ark.cn-beijing.volces.com/api/v3",
            seedance_model_id="doubao-seedance-2-0-260128",
        )
        provider.api_key = "test-key"
        provider.base_url = "https://ark.cn-beijing.volces.com/api/v3"
        provider.model_id = "doubao-seedance-2-0-260128"
        provider._request_json = lambda *args, **kwargs: {"id": "cgt-123"}  # type: ignore[attr-defined]

        tiny_png = b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6pGZkAAAAASUVORK5CYII="
        )

        with self.assertRaises(SeedanceVideoProviderError):
            await SeedanceVideoProvider.create_video_task(
                provider,
                prompt="let the model turn around",
                duration=5,
                resolution="720P",
                input_images=(("reference.png", tiny_png, "image/png"),),
                mode="first-frame",
                aspect_ratio="auto",
            )


if __name__ == "__main__":
    unittest.main()
