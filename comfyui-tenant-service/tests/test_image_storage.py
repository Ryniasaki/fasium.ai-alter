import io

from PIL import Image

from app.services.image_storage import ImageStorageService


def _png_bytes(width: int, height: int) -> bytes:
    image = Image.new("RGB", (width, height), (240, 240, 240))
    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def test_store_uploaded_image_resizes_long_edge_to_limit(tmp_path):
    service = ImageStorageService(base_storage_path=str(tmp_path))

    entry = service.store_uploaded_image(
        user_id="user-1",
        file_bytes=_png_bytes(3200, 1600),
        original_filename="large.png",
        content_type="image/png",
    )

    with Image.open(entry["localPath"]) as stored:
        assert stored.size == (2000, 1000)


def test_store_uploaded_image_keeps_small_image_size(tmp_path):
    service = ImageStorageService(base_storage_path=str(tmp_path))

    entry = service.store_uploaded_image(
        user_id="user-1",
        file_bytes=_png_bytes(1200, 800),
        original_filename="small.png",
        content_type="image/png",
    )

    with Image.open(entry["localPath"]) as stored:
        assert stored.size == (1200, 800)
