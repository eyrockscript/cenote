resource "aws_instance" "api" {
  ami           = "ami-0123456789abcdef0"
  instance_type = "t3.small"
  subnet_id     = aws_subnet.private_a.id
  vpc_security_group_ids = [aws_security_group.web.id]
  tags = {
    Name = "api"
  }
}

resource "aws_lb" "public" {
  name               = "public-alb"
  load_balancer_type = "application"
  subnets            = [aws_subnet.public_a.id]
  security_groups    = [aws_security_group.web.id]
}

resource "aws_lb_target_group" "api_tg" {
  name     = "api-tg"
  port     = 8080
  protocol = "HTTP"
  vpc_id   = aws_vpc.main.id
}

resource "aws_s3_bucket" "assets" {
  bucket = "cenote-demo-assets"
}
