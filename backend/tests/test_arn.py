from cenote.core.arn import tf_to_arn


def test_vpc():
    arn = tf_to_arn("aws_vpc", {"id": "vpc-abc"}, "123456789012", "us-east-1")
    assert arn == "arn:aws:ec2:us-east-1:123456789012:vpc/vpc-abc"


def test_instance():
    arn = tf_to_arn("aws_instance", {"id": "i-1234"}, "123456789012", "us-east-1")
    assert arn == "arn:aws:ec2:us-east-1:123456789012:instance/i-1234"


def test_s3_uses_bucket_name():
    arn = tf_to_arn("aws_s3_bucket", {"bucket": "my-bucket"}, "123456789012", "us-east-1")
    assert arn == "arn:aws:s3:::my-bucket"


def test_lambda_uses_arn_when_present():
    arn = tf_to_arn(
        "aws_lambda_function",
        {"arn": "arn:aws:lambda:us-east-1:123456789012:function:my-fn"},
        "123456789012",
        "us-east-1",
    )
    assert arn == "arn:aws:lambda:us-east-1:123456789012:function:my-fn"


def test_returns_none_for_unknown_type():
    assert tf_to_arn("aws_unsupported", {"id": "x"}, "1", "us-east-1") is None
