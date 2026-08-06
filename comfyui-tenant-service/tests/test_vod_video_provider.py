from types import SimpleNamespace
import unittest

from app.services.vod_video_provider import VodVideoProvider, VodVideoProviderError


class VodVideoProviderTests(unittest.IsolatedAsyncioTestCase):
    async def test_reference_mode_uses_up_to_three_input_images(self) -> None:
        provider = VodVideoProvider.__new__(VodVideoProvider)
        provider.settings = SimpleNamespace(
            vod_video_model_name="Kling",
            vod_video_model_version="3.0-Omni",
            vod_video_duration_seconds=5,
            vod_video_resolution="720P",
            vod_video_audio_generation="Disabled",
            vod_video_enhance_prompt="Enabled",
            vod_video_input_region="Mainland",
            vod_sub_app_id=123456,
        )

        upload_calls: list[str] = []
        captured: dict[str, object] = {}

        async def upload_input_image(*, filename: str, file_bytes: bytes, mime_type: str):
            upload_calls.append(filename)
            return {"file_id": f"fid-{filename}", "media_url": f"https://example.invalid/{filename}"}

        def prepare_reference_image(*, file_bytes: bytes, mime_type: str):
            return file_bytes, mime_type or "image/png"

        def fake_call_action(action: str, params: dict[str, object]):
            captured["action"] = action
            captured["params"] = params
            return {"TaskId": "task-123"}

        provider._upload_input_image = upload_input_image  # type: ignore[attr-defined]
        provider.prepare_reference_image = prepare_reference_image  # type: ignore[attr-defined]
        provider._call_action = fake_call_action  # type: ignore[attr-defined]

        result = await VodVideoProvider.create_video_task(
            provider,
            prompt="generate a clip",
            input_images=(
                ("ref-1.png", b"1", "image/png"),
                ("ref-2.png", b"2", "image/png"),
                ("ref-3.png", b"3", "image/png"),
            ),
            duration=5,
            resolution="720P",
            mode="reference",
            aspect_ratio="auto",
        )

        self.assertEqual(result["task_id"], "task-123")
        self.assertEqual(upload_calls, ["ref-1.png", "ref-2.png", "ref-3.png"])
        self.assertEqual(captured["action"], "CreateAigcVideoTask")
        params = captured["params"]
        self.assertIsInstance(params, dict)
        file_infos = params["FileInfos"]
        self.assertEqual(len(file_infos), 3)
        self.assertTrue(all(item["Usage"] == "Reference" for item in file_infos))

    async def test_reference_mode_rejects_more_than_three_images(self) -> None:
        provider = VodVideoProvider.__new__(VodVideoProvider)
        provider.settings = SimpleNamespace(
            vod_video_model_name="Kling",
            vod_video_model_version="3.0-Omni",
            vod_video_duration_seconds=5,
            vod_video_resolution="720P",
            vod_video_audio_generation="Disabled",
            vod_video_enhance_prompt="Enabled",
            vod_video_input_region="Mainland",
            vod_sub_app_id=123456,
        )

        async def upload_input_image(*, filename: str, file_bytes: bytes, mime_type: str):
            return {"file_id": f"fid-{filename}", "media_url": f"https://example.invalid/{filename}"}

        def prepare_reference_image(*, file_bytes: bytes, mime_type: str):
            return file_bytes, mime_type or "image/png"

        provider._upload_input_image = upload_input_image  # type: ignore[attr-defined]
        provider.prepare_reference_image = prepare_reference_image  # type: ignore[attr-defined]
        provider._call_action = lambda action, params: {"TaskId": "task-123"}  # type: ignore[attr-defined]

        with self.assertRaises(VodVideoProviderError):
            await VodVideoProvider.create_video_task(
                provider,
                prompt="generate a clip",
                input_images=(
                    ("ref-1.png", b"1", "image/png"),
                    ("ref-2.png", b"2", "image/png"),
                    ("ref-3.png", b"3", "image/png"),
                    ("ref-4.png", b"4", "image/png"),
                ),
                duration=5,
                resolution="720P",
                mode="reference",
                aspect_ratio="auto",
            )


if __name__ == "__main__":
    unittest.main()
