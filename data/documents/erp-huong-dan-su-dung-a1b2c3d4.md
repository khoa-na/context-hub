# Hướng Dẫn Sử Dụng Hệ Thống ERP

## 1. Giới thiệu chung

Hệ thống ERP (Enterprise Resource Planning) là nền tảng quản lý tổng thể của công ty, bao gồm các module: Kế toán, Nhân sự, Mua hàng, Bán hàng, và Kho. Tất cả nhân viên đều được cấp tài khoản truy cập theo phòng ban.

## 2. Đăng nhập và bảo mật

### 2.1 Đăng nhập lần đầu

Mỗi nhân viên mới sẽ nhận email kích hoạt từ Phòng IT chứa:
- Link đăng nhập: https://erp.company.local
- Tên đăng nhập: mã nhân viên (VD: NV00123)
- Mật khẩu tạm thời: 8 ký tự ngẫu nhiên
- Yêu cầu đổi mật khẩu trong lần đăng nhập đầu tiên

### 2.2 Quy định mật khẩu

- Độ dài tối thiểu 12 ký tự
- Phải chứa: chữ hoa, chữ thường, số, ký tự đặc biệt
- Đổi mỗi 90 ngày
- Không trùng 5 mật khẩu gần nhất
- Tài khoản khóa sau 5 lần nhập sai

### 2.3 Xác thực hai lớp (2FA)

- Bắt buộc cho tất cả phân hệ từ Level 2 trở lên
- Sử dụng Google Authenticator hoặc Microsoft Authenticator
- Mã dự phòng lưu tại Phòng IT, cấp khi mất thiết bị

## 3. Module Kế toán

### 3.1 Xuất hóa đơn

1. Vào Phân hệ Kế toán → Xuất hóa đơn
2. Chọn loại hóa đơn: GTGT / Xuất khẩu / Nội bộ
3. Điền thông tin khách hàng hoặc chọn từ danh sách
4. Thêm dòng hàng hóa/dịch vụ, kiểm tra thuế suất
5. Kiểm tra tổng tiền, bấm "Xuất hóa đơn"
6. Hóa đơn được số thứ tự tự động theo quy định của Cơ quan Thuế

### 3.2 Báo cáo thuế

- Báo cáo thuế GTGT: Hàng tháng, hạn chót ngày 20 tháng sau
- Báo cáo thuế TNDN: Hàng quý, hạn chót ngày 30 tháng sau quý
- Tự động tổng hợp từ sổ kế toán, kiểm tra chéo với hóa đơn đầu vào/đầu ra
- Kế toán trưởng kiểm tra và nộp qua cổng thông tin thuế điện tử

### 3.3 Phân quyền kế toán

| Vai trò | Phân hệ được truy cập |
|---|---|
| Kế toán viên | Xuất hóa đơn, nhập liệu sổ cái |
| Kế toán trưởng | Toàn bộ phân hệ Kế toán + phê duyệt |
| Giám đốc | Báo cáo tổng hợp, phê duyệt chi lớn |

## 4. Module Nhân sự

### 4.1 Xin nghỉ phép

1. Đăng nhập ERP → Phân hệ Nhân sự → Xin nghỉ
2. Chọn loại nghỉ: Phép năm / Ốm / Việc riêng / Thai sản
3. Chọn ngày bắt đầu, ngày kết thúc
4. Ghi chú lý do (bắt buộc nếu nghỉ trên 3 ngày)
5. Hệ thống tự động gửi yêu cầu phê duyệt đến Trưởng phòng
6. Trưởng phòng phê duyệt trong 24 giờ, quá hạn hệ thống tự động duyệt

### 4.2 Theo dõi ngày phép

- Xem số ngày phép còn lại: Phân hệ Nhân sự → Cán bộ → Ngày phép
- Phép dư tối đa chuyển sang năm sau: 5 ngày
- Phép dư vượt 5 ngày tự động quy đổi thành tiền (80% lương ngày thường)

### 4.3 Chấm công

- Chấm công bằng vân tay hoặc quét mã QR qua app
- Giờ làm việc: 8:00 - 17:30, nghỉ trưa 12:00 - 13:30
- Đi muộn trên 15 phút: tính nửa ngày nghỉ phép
- Quên chấm công: bổ sung trong 3 ngày, cần xác nhận của Trưởng phòng

## 5. Module Bán hàng

### 5.1 Tạo đơn hàng bán

1. Phân hệ Bán hàng → Đơn hàng mới
2. Chọn khách hàng từ danh sách hoặc tạo mới
3. Thêm sản phẩm, hệ thống tự động điền giá theo bảng giá hiện tại
4. Kiểm tra tồn kho tự động, cảnh báo nếu hàng không đủ
5. Gửi báo giá cho khách hàng qua email tích hợp
6. Khách hàng xác nhận → Đơn hàng chuyển sang trạng thái "Đã xác nhận"
7. Tạo phiếu xuất kho và phiếu giao hàng tự động

### 5.2 Phê duyệt đơn bán lớn

- Đơn < 10 triệu: Trưởng phòng duyệt
- Đơn 10-50 triệu: Phó Giám đốc duyệt
- Đơn > 50 triệu: Giám đốc duyệt
- Đơn > 200 triệu: HĐQT duyệt

## 6. Module Kho

### 6.1 Nhập kho

- Quét mã vạch hoặc nhập tay mã hàng hóa
- Đối chiếu với đơn đặt hàng (PO)
- Nếu khớp: xác nhận nhập kho tự động
- Nếu sai số lượng/sai mã: ghi nhận bất hợp lệ, yêu cầu nhà cung cấp xử lý trong 7 ngày

### 6.2 Kiểm kê

- Kiểm kê định kỳ: mỗi quý 1 lần
- Kiểm kê đột xuất: khi có yêu cầu từ Giám đốc
- Chênh lệch tồn kho > 2%: phải có giải trình bằng văn bản
- Chênh lệch > 5%: lập biên bản, báo cáo Giám đốc và Phòng Tài chính