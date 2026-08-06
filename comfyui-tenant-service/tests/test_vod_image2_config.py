from types import SimpleNamespace
import unittest

from app.services.openai_image_provider import ImageProviderError, resolve_vod_image_task_config


class VodImage2ConfigTests(unittest.TestCase):
    def test_defaults_to_existing_vod_model(self) -> None:
        settings = SimpleNamespace(
            vod_model_name="GEM",
            vod_model_version="3.1",
            vod_image2_model_version="image2_medium",
            vod_image2_resolution="1K",
            vod_image2_aspect_ratio=None,
        )

        config = resolve_vod_image_task_config(settings=settings, requested_model=None)

        self.assertEqual(config.model_name, "GEM")
        self.assertEqual(config.model_version, "3.1")
        self.assertEqual(config.billing_model_name, "GEM:3.1")
        self.assertIsNone(config.resolution)
        self.assertIsNone(config.aspect_ratio)
        self.assertEqual(config.max_reference_images, 4)
        self.assertFalse(config.is_image2)

    def test_maps_image2_profile(self) -> None:
        settings = SimpleNamespace(
            vod_model_name="GEM",
            vod_model_version="3.1",
            vod_image2_model_version="image2_medium",
            vod_image2_resolution="1K",
            vod_image2_aspect_ratio="16:9",
        )

        config = resolve_vod_image_task_config(settings=settings, requested_model="Image2")

        self.assertEqual(config.model_name, "OG")
        self.assertEqual(config.model_version, "image2_medium")
        self.assertEqual(config.billing_model_name, "OG:image2_medium")
        self.assertEqual(config.resolution, "1K")
        self.assertEqual(config.aspect_ratio, "16:9")
        self.assertEqual(config.max_reference_images, 3)
        self.assertTrue(config.is_image2)

    def test_rejects_invalid_aspect_ratio(self) -> None:
        settings = SimpleNamespace(
            vod_model_name="GEM",
            vod_model_version="3.1",
            vod_image2_model_version="image2_medium",
            vod_image2_resolution="1K",
            vod_image2_aspect_ratio="2:1",
        )

        with self.assertRaises(ImageProviderError):
            resolve_vod_image_task_config(settings=settings, requested_model="image2")


if __name__ == "__main__":
    unittest.main()
